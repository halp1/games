/**
 * Room registry, seating, and the authoritative command handler.
 *
 * Rooms live in memory only. A deploy restarts the process and wipes them, which is a
 * deliberate v1 trade: the client detects `ROOM_NOT_FOUND` and offers a fresh room rather
 * than hanging. Persisting rooms would mean serialising on SIGTERM, which is not worth it
 * until games are long enough for that to sting.
 *
 * Every command handler here is synchronous. That is load-bearing: it is what serialises the
 * any-time declare race, since two clients racing for the same set are simply processed in
 * arrival order and the second gets `SET_ALREADY_RESOLVED`. Introducing an `await` inside a
 * handler would silently reopen that window.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { isTableSize, type TableSize } from '../lib/literature/cards';
import {
	CODE_ALPHABET,
	CODE_LENGTH,
	PROTOCOL_VERSION,
	cleanCode,
	cleanName,
	isClientMsg,
	type ClientMsg,
	type ErrorCode,
	type RoomSeat,
	type RoomView,
	type ServerMsg
} from '../lib/literature/protocol';
import {
	applyAsk,
	applyChooseFinalDeclarer,
	applyDeclare,
	applyHandoff,
	canAsk,
	canChooseFinalDeclarer,
	canDeclare,
	canHandoff,
	createGame,
	isHalfSuit,
	teamOf,
	type GameOptions,
	type GameState,
	type SeatId
} from '../lib/literature/rules';
import { toPlayerView, type TableMeta } from '../lib/literature/view';

/** How long a lobby seat is held for someone who dropped, so a refresh does not cost it. */
const LOBBY_GRACE_MS = 30_000;
/** Rooms with nobody connected are collected after this. */
const ROOM_IDLE_MS = 10 * 60_000;
/** A socket that has not spoken in this long is assumed dead. Clients ping every 15s. */
const SOCKET_SILENCE_MS = 45_000;

export interface Connection {
	send(msg: ServerMsg): void;
	close(): void;
}

export interface Session {
	conn: Connection;
	room: Room | null;
	token: string | null;
	lastSeen: number;
}

interface Seat {
	name: string;
	isBot: boolean;
	/** Secret. Never leaves the server except to the one client that owns it. */
	token: string;
	session: Session | null;
	/** When the socket dropped, for the lobby grace period. Null while connected. */
	droppedAt: number | null;
}

export interface Room {
	code: string;
	size: TableSize;
	options: GameOptions;
	seats: (Seat | null)[];
	hostToken: string;
	game: GameState | null;
	updatedAt: number;
}

const rooms = new Map<string, Room>();

/** Set by `ws.ts` so bots can react to a new position without rooms.ts importing bots.ts. */
let onRoomChanged: ((room: Room) => void) | null = null;
export function setRoomListener(fn: (room: Room) => void): void {
	onRoomChanged = fn;
}

/* ---------------------------------------------------------------- helpers */

function newCode(): string {
	for (let attempt = 0; attempt < 200; attempt++) {
		let code = '';
		for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
		if (!rooms.has(code)) return code;
	}
	/* Effectively unreachable at 32^4 codes; better to be loud than to loop forever. */
	throw new Error('could not allocate a room code');
}

function seatOf(room: Room, token: string | null): SeatId {
	if (!token) return -1;
	return room.seats.findIndex((seat) => seat?.token === token);
}

function occupants(room: Room): Seat[] {
	return room.seats.filter((seat): seat is Seat => seat !== null);
}

/** The seat holding up a paused game, or null when play may proceed. */
function pausedSeat(room: Room): SeatId | null {
	if (!room.game) return null;
	for (let seat = 0; seat < room.size; seat++) {
		const player = room.seats[seat];
		if (player && !player.isBot && !player.session) return seat;
	}
	return null;
}

function metaOf(room: Room): TableMeta {
	return {
		names: room.seats.map((seat) => seat?.name ?? ''),
		bots: room.seats.map((seat) => seat?.isBot ?? false),
		connected: room.seats.map((seat) => (seat ? seat.isBot || seat.session !== null : false)),
		host: Math.max(
			0,
			room.seats.findIndex((seat) => seat?.token === room.hostToken)
		)
	};
}

function viewFor(room: Room, you: SeatId): RoomView {
	const seats: RoomSeat[] = room.seats.map((seat, index) => ({
		seat: index,
		team: teamOf(index),
		name: seat?.name ?? '',
		filled: seat !== null,
		isBot: seat?.isBot ?? false,
		connected: seat ? seat.isBot || seat.session !== null : false,
		isHost: seat?.token === room.hostToken,
		isYou: index === you
	}));

	const stalled = pausedSeat(room);

	return {
		code: room.code,
		you,
		stage: room.game ? 'game' : 'lobby',
		size: room.size,
		options: room.options,
		seats,
		isHost: room.seats[you]?.token === room.hostToken,
		canStart: !room.game && occupants(room).length === room.size,
		paused:
			stalled === null ? null : { seat: stalled, name: room.seats[stalled]?.name ?? 'a player' },
		game: room.game ? toPlayerView(room.game, you, metaOf(room)) : null
	};
}

export function broadcast(room: Room): void {
	room.updatedAt = Date.now();
	room.seats.forEach((seat, index) => {
		if (!seat?.session) return;
		seat.session.conn.send({ t: 'room', view: viewFor(room, index) });
	});
	onRoomChanged?.(room);
}

function fail(session: Session, code: ErrorCode, message = code): void {
	session.conn.send({ t: 'error', code, message });
}

/** Hands the host role to any other human, preferring the lowest seat. */
function transferHost(room: Room): void {
	const next = occupants(room).find((seat) => !seat.isBot && seat.token !== room.hostToken);
	if (next) room.hostToken = next.token;
}

/** Re-seats occupants into the given order, packing them from seat 0. */
function reseat(room: Room, people: (Seat | null)[]): void {
	room.seats = Array.from({ length: room.size }, (_, index) => people[index] ?? null);
}

/* ---------------------------------------------------------------- joining */

function attach(session: Session, room: Room, seat: SeatId): void {
	const player = room.seats[seat];
	if (!player) return;

	/* Two tabs on one token: the newest wins, so a stale tab cannot keep playing. */
	if (player.session && player.session !== session) {
		const stale = player.session;
		stale.room = null;
		stale.token = null;
		stale.conn.close();
	}

	session.room = room;
	session.token = player.token;
	session.lastSeen = Date.now();
	player.session = session;
	player.droppedAt = null;

	session.conn.send({ t: 'welcome', room: room.code, token: player.token, seat });
}

function create(session: Session, msg: Extract<ClientMsg, { t: 'create' }>): void {
	if (msg.v !== PROTOCOL_VERSION) return fail(session, 'BAD_VERSION');
	const name = cleanName(msg.name);
	if (!name) return fail(session, 'BAD_NAME');
	if (!isTableSize(msg.size)) return fail(session, 'BAD_MESSAGE');

	const token = randomUUID();
	const room: Room = {
		code: newCode(),
		size: msg.size,
		options: { antiDeclare: msg.antiDeclare === true },
		seats: Array.from({ length: msg.size }, () => null),
		hostToken: token,
		game: null,
		updatedAt: Date.now()
	};
	room.seats[0] = { name, isBot: false, token, session: null, droppedAt: null };
	rooms.set(room.code, room);

	leave(session);
	attach(session, room, 0);
	broadcast(room);
}

function join(session: Session, msg: Extract<ClientMsg, { t: 'join' }>): void {
	if (msg.v !== PROTOCOL_VERSION) return fail(session, 'BAD_VERSION');
	const name = cleanName(msg.name);
	if (!name) return fail(session, 'BAD_NAME');
	const code = cleanCode(msg.room);
	if (!code) return fail(session, 'ROOM_NOT_FOUND');

	const room = rooms.get(code);
	if (!room) return fail(session, 'ROOM_NOT_FOUND');

	leave(session);

	/* Reclaiming a held seat: the token is the only thing that proves it is yours. */
	const held = seatOf(room, msg.token ?? null);
	if (held >= 0) {
		attach(session, room, held);
		broadcast(room);
		return;
	}

	/* Otherwise take an open seat. Mid-game there are none — every seat is reserved. */
	if (room.game) return fail(session, 'GAME_IN_PROGRESS');
	const open = room.seats.findIndex((seat) => seat === null);
	if (open < 0) return fail(session, 'ROOM_FULL');

	room.seats[open] = { name, isBot: false, token: randomUUID(), session: null, droppedAt: null };
	attach(session, room, open);
	broadcast(room);
}

/** Detaches a session from whatever room it was in, without dropping the seat. */
function leave(session: Session): void {
	const room = session.room;
	if (!room) return;
	const seat = seatOf(room, session.token);
	const player = seat >= 0 ? room.seats[seat] : null;
	if (player?.session === session) {
		player.session = null;
		player.droppedAt = Date.now();
	}
	session.room = null;
	session.token = null;
}

/* ---------------------------------------------------------------- lobby */

function setSize(room: Room, size: TableSize): ErrorCode | null {
	const people = occupants(room);
	const humans = people.filter((seat) => !seat.isBot);
	if (humans.length > size) return 'TOO_MANY_PLAYERS';

	/* Shrinking sheds bots first — they are disposable, humans are not. */
	const keep = [...humans];
	for (const bot of people.filter((seat) => seat.isBot)) {
		if (keep.length >= size) break;
		keep.push(bot);
	}

	room.size = size;
	reseat(room, keep);
	return null;
}

function nextBotName(room: Room): string {
	const used = new Set(occupants(room).map((seat) => seat.name));
	for (let n = 1; ; n++) {
		const name = `Bot ${n}`;
		if (!used.has(name)) return name;
	}
}

function handleLobby(session: Session, room: Room, msg: ClientMsg): void {
	if (room.hostToken !== session.token) return fail(session, 'NOT_HOST');
	if (room.game) return fail(session, 'NOT_IN_LOBBY');

	switch (msg.t) {
		case 'setSize': {
			if (!isTableSize(msg.size)) return fail(session, 'BAD_MESSAGE');
			const error = setSize(room, msg.size);
			if (error) return fail(session, error);
			break;
		}
		case 'setAntiDeclare':
			room.options = { ...room.options, antiDeclare: msg.on === true };
			break;
		case 'shuffleSeats': {
			const people = occupants(room);
			for (let i = people.length - 1; i > 0; i--) {
				const j = randomInt(i + 1);
				[people[i], people[j]] = [people[j], people[i]];
			}
			reseat(room, people);
			break;
		}
		case 'swapSeats': {
			const { a, b } = msg;
			const valid = (seat: number) => Number.isInteger(seat) && seat >= 0 && seat < room.size;
			if (!valid(a) || !valid(b)) return fail(session, 'BAD_MESSAGE');
			[room.seats[a], room.seats[b]] = [room.seats[b], room.seats[a]];
			break;
		}
		case 'addBot': {
			const open = room.seats.findIndex((seat) => seat === null);
			if (open < 0) return fail(session, 'ROOM_FULL');
			room.seats[open] = {
				name: nextBotName(room),
				isBot: true,
				token: randomUUID(),
				session: null,
				droppedAt: null
			};
			break;
		}
		case 'removeSeat': {
			const { seat } = msg;
			if (!Number.isInteger(seat) || seat < 0 || seat >= room.size)
				return fail(session, 'BAD_MESSAGE');
			const player = room.seats[seat];
			if (!player) break;
			/* The host cannot remove themselves; leaving is what that is for. */
			if (player.token === room.hostToken) return fail(session, 'BAD_MESSAGE');
			player.session?.conn.close();
			room.seats[seat] = null;
			break;
		}
		case 'start': {
			if (occupants(room).length !== room.size) return fail(session, 'SEATS_NOT_FULL');
			room.game = createGame(room.size, room.options, Math.random);
			break;
		}
	}

	broadcast(room);
}

/* ---------------------------------------------------------------- play */

/**
 * Applies a game command on behalf of a seat. Shared by human sessions and bots, so a bot can
 * never take a move a human could not — the legality checks live in exactly one place.
 */
export function applyGameCommand(room: Room, seat: SeatId, msg: ClientMsg): ErrorCode | null {
	const game = room.game;
	if (!game) return 'GAME_NOT_STARTED';
	if (pausedSeat(room) !== null) return 'GAME_PAUSED';

	switch (msg.t) {
		case 'ask': {
			const error = canAsk(game, seat, msg.target, msg.card);
			if (error) return error;
			room.game = applyAsk(game, seat, msg.target, msg.card);
			break;
		}
		case 'declare': {
			if (!isHalfSuit(msg.set)) return 'UNKNOWN_SET';
			const error = canDeclare(game, seat, msg.set, msg.mode, msg.assign);
			if (error) return error;
			room.game = applyDeclare(game, seat, msg.set, msg.mode, msg.assign);
			break;
		}
		case 'handoff': {
			const error = canHandoff(game, seat, msg.to);
			if (error) return error;
			room.game = applyHandoff(game, seat, msg.to);
			break;
		}
		case 'chooseFinalDeclarer': {
			const error = canChooseFinalDeclarer(game, seat, msg.seat);
			if (error) return error;
			room.game = applyChooseFinalDeclarer(game, seat, msg.seat);
			break;
		}
		default:
			return 'BAD_MESSAGE';
	}

	broadcast(room);
	return null;
}

/* ---------------------------------------------------------------- entry point */

export function handle(session: Session, raw: unknown): void {
	session.lastSeen = Date.now();

	if (!isClientMsg(raw)) return fail(session, 'BAD_MESSAGE');
	const msg = raw;

	if (msg.t === 'ping') return session.conn.send({ t: 'pong' });
	if (msg.t === 'create') return create(session, msg);
	if (msg.t === 'join') return join(session, msg);

	const room = session.room;
	if (!room) return fail(session, 'NOT_IN_A_ROOM');
	const seat = seatOf(room, session.token);
	if (seat < 0) return fail(session, 'NOT_IN_A_ROOM');

	switch (msg.t) {
		case 'setSize':
		case 'setAntiDeclare':
		case 'shuffleSeats':
		case 'swapSeats':
		case 'addBot':
		case 'removeSeat':
		case 'start':
			return handleLobby(session, room, msg);

		case 'rematch': {
			if (room.hostToken !== session.token) return fail(session, 'NOT_HOST');
			if (!room.game || room.game.phase.kind !== 'over') return fail(session, 'BAD_MESSAGE');
			room.game = null;
			return broadcast(room);
		}

		case 'leave': {
			disconnect(session);
			return session.conn.close();
		}

		default: {
			const error = applyGameCommand(room, seat, msg);
			if (error) fail(session, error);
			return;
		}
	}
}

export function disconnect(session: Session): void {
	const room = session.room;
	if (!room) return;
	leave(session);
	broadcast(room);
}

/* ---------------------------------------------------------------- upkeep */

/**
 * Frees lapsed lobby seats, drops silent sockets, and collects dead rooms. A seat in a
 * running game is never freed — it is reserved for its owner however long they are gone.
 */
export function sweep(now = Date.now()): void {
	for (const [code, room] of rooms) {
		let changed = false;

		for (let index = 0; index < room.size; index++) {
			const player = room.seats[index];
			if (!player) continue;

			if (player.session && now - player.session.lastSeen > SOCKET_SILENCE_MS) {
				player.session.conn.close();
				player.session = null;
				player.droppedAt = now;
				changed = true;
			}

			if (
				!room.game &&
				!player.isBot &&
				!player.session &&
				player.droppedAt !== null &&
				now - player.droppedAt > LOBBY_GRACE_MS
			) {
				const wasHost = player.token === room.hostToken;
				room.seats[index] = null;
				if (wasHost) transferHost(room);
				changed = true;
			}
		}

		const anyoneHere = occupants(room).some((seat) => seat.session !== null);
		if (!anyoneHere && now - room.updatedAt > ROOM_IDLE_MS) {
			rooms.delete(code);
			continue;
		}

		if (changed) broadcast(room);
	}
}

/* ---------------------------------------------------------------- bot seam */

/**
 * Whose move the game is waiting on, or null when it is waiting on nobody. Phase and turn
 * are public information — every player can see whose move it is — so exposing this leaks
 * nothing that is not already on the wire.
 */
export function actingSeat(room: Room): SeatId | null {
	const game = room.game;
	if (!game) return null;
	switch (game.phase.kind) {
		case 'playing':
			return game.turn;
		case 'awaiting_handoff':
			return game.phase.seat;
		case 'choosing_final_declarer':
			return game.phase.chooser;
		case 'final_declarations':
			return game.phase.declarer;
		case 'over':
			return null;
	}
}

export function isBotSeat(room: Room, seat: SeatId): boolean {
	return room.seats[seat]?.isBot === true;
}

export function isPaused(room: Room): boolean {
	return pausedSeat(room) !== null;
}

/**
 * The redacted view for a seat — the same one a human at that seat receives. This is how
 * bots see the game, and it is the only way they can: they get no privileged access to room
 * state, so "a bot cannot see more than you can" is a property of the wiring, not a promise.
 */
export function playerViewFor(room: Room, seat: SeatId) {
	if (!room.game) return null;
	return toPlayerView(room.game, seat, metaOf(room));
}

/** Test seam. */
export function roomCount(): number {
	return rooms.size;
}
