/**
 * The browser half of the connection: one WebSocket, one `$state` snapshot, and the
 * reconnection logic that makes a phone locking mid-game a non-event.
 *
 * The server only ever sends whole redacted snapshots, so there is nothing to merge here and
 * no local copy of the rules to keep in sync — `view` is simply the last thing the server
 * said. That is also why reconnecting is just re-joining: there is no history to replay,
 * which suits a game whose whole premise is that you remember rather than scroll back.
 */
import { browser } from '$app/environment';
import {
	PROTOCOL_VERSION,
	WS_PATH,
	type ClientMsg,
	type RoomView,
	type ServerMsg
} from './protocol';
import type { TableSize } from './cards';

const PING_MS = 15_000;
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 8_000;

export const NAME_KEY = 'literature:name';
const tokenKey = (room: string) => `literature:token:${room}`;

/**
 * Seat tokens live in **sessionStorage**, which is per-tab; the remembered name lives in
 * localStorage, which is shared.
 *
 * That split is the whole point. A token is an identity claim on a seat, and localStorage is
 * shared by every tab on the origin — so two tabs would present the same token and fight over
 * one seat. sessionStorage survives a reload and a backgrounded phone, which is what
 * reconnecting actually needs, while giving each tab an identity of its own.
 *
 * The cost is that closing a tab mid-game loses the seat for good. The host can end the game
 * from the pause overlay when that happens.
 */
const seatStore = () => (browser ? sessionStorage : null);

export type Status = 'idle' | 'connecting' | 'open' | 'reconnecting';

/** What to (re)send once the socket opens. Survives reconnects; that is the point. */
type Intent =
	| { kind: 'create'; name: string; size: TableSize; antiDeclare: boolean }
	| { kind: 'join'; name: string; room: string };

export function storedName(): string {
	if (!browser) return '';
	return localStorage.getItem(NAME_KEY) ?? '';
}

export function rememberName(name: string): void {
	if (browser) localStorage.setItem(NAME_KEY, name);
}

export class Table {
	/** The whole game, as of the server's last word. Null until the first snapshot. */
	view = $state<RoomView | null>(null);
	status = $state<Status>('idle');
	/** Last rejected command, for a toast. Cleared on the next successful snapshot. */
	error = $state<string | null>(null);
	/** True between sending a command and the snapshot that answers it. */
	busy = $state(false);
	/** Set when the room is gone for good, so the UI can offer a fresh one instead of hanging. */
	lost = $state(false);

	#socket: WebSocket | null = null;
	#intent: Intent | null = null;
	#ping: ReturnType<typeof setInterval> | null = null;
	#retry: ReturnType<typeof setTimeout> | null = null;
	#attempts = 0;
	#stopped = false;

	create(name: string, size: TableSize, antiDeclare: boolean): void {
		rememberName(name);
		this.#start({ kind: 'create', name, size, antiDeclare });
	}

	join(room: string, name: string): void {
		rememberName(name);
		this.#start({ kind: 'join', name, room: room.toUpperCase() });
	}

	send(msg: ClientMsg): void {
		if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) return;
		this.busy = true;
		this.error = null;
		this.#socket.send(JSON.stringify(msg));
	}

	/** Leaves for good. Safe to call from `onDestroy` whether or not we ever connected. */
	stop(): void {
		this.#stopped = true;
		this.#clearTimers();
		this.#socket?.close();
		this.#socket = null;
		this.status = 'idle';
	}

	#start(intent: Intent): void {
		if (!browser) return;
		this.#stopped = false;
		this.#intent = intent;
		this.#attempts = 0;
		this.lost = false;
		this.#open();
	}

	#open(): void {
		if (this.#stopped || !this.#intent) return;

		this.status = this.#attempts === 0 ? 'connecting' : 'reconnecting';

		const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const socket = new WebSocket(`${scheme}//${location.host}${WS_PATH}`);
		this.#socket = socket;

		socket.addEventListener('open', () => {
			this.#attempts = 0;
			this.status = 'open';
			this.#greet();
			this.#ping = setInterval(() => this.send({ t: 'ping' }), PING_MS);
		});

		socket.addEventListener('message', (event) => {
			let msg: ServerMsg;
			try {
				msg = JSON.parse(String(event.data)) as ServerMsg;
			} catch {
				return;
			}
			this.#receive(msg);
		});

		socket.addEventListener('close', () => {
			this.#clearTimers();
			if (this.#stopped || this.lost) return;
			this.status = 'reconnecting';
			this.#scheduleRetry();
		});

		/* 'close' always follows 'error', so retrying is handled in one place. */
		socket.addEventListener('error', () => socket.close());
	}

	/** Introduces us to the server. A stored token is what reclaims a held seat. */
	#greet(): void {
		const intent = this.#intent;
		if (!intent) return;

		if (intent.kind === 'create') {
			this.send({
				t: 'create',
				v: PROTOCOL_VERSION,
				name: intent.name,
				size: intent.size,
				antiDeclare: intent.antiDeclare
			});
			return;
		}

		this.send({
			t: 'join',
			v: PROTOCOL_VERSION,
			name: intent.name,
			room: intent.room,
			token: seatStore()?.getItem(tokenKey(intent.room)) ?? undefined
		});
	}

	#receive(msg: ServerMsg): void {
		switch (msg.t) {
			case 'welcome':
				seatStore()?.setItem(tokenKey(msg.room), msg.token);
				/* Reconnects must re-join rather than re-create, or a dropped host would spawn a
				   new room on every blip and strand everybody in the old one. */
				this.#intent = { kind: 'join', name: this.#intent?.name ?? '', room: msg.room };
				break;

			case 'room':
				this.view = msg.view;
				this.busy = false;
				this.error = null;
				break;

			case 'error':
				this.busy = false;
				this.error = describe(msg.code, msg.message);
				if (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'GAME_IN_PROGRESS') {
					/* Nothing to reconnect to — a deploy wiped the room, or it filled without us. */
					if (this.#intent?.kind === 'join') seatStore()?.removeItem(tokenKey(this.#intent.room));
					this.lost = true;
					this.stop();
				}
				break;

			case 'pong':
				break;
		}
	}

	#scheduleRetry(): void {
		this.#attempts++;
		const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (this.#attempts - 1));
		this.#retry = setTimeout(() => this.#open(), delay);
	}

	#clearTimers(): void {
		if (this.#ping) clearInterval(this.#ping);
		if (this.#retry) clearTimeout(this.#retry);
		this.#ping = null;
		this.#retry = null;
	}
}

/** Turns a wire error code into something worth showing a player. */
function describe(code: string, fallback: string): string {
	switch (code) {
		case 'ROOM_NOT_FOUND':
			return 'That room no longer exists.';
		case 'ROOM_FULL':
			return 'That room is full.';
		case 'GAME_IN_PROGRESS':
			return 'That game has already started.';
		case 'SEATS_NOT_FULL':
			return 'Every seat needs a player first.';
		case 'TOO_MANY_PLAYERS':
			return 'Too many players for that table size.';
		case 'NOT_HOST':
			return 'Only the host can do that.';
		case 'GAME_PAUSED':
			return 'Waiting for a player to reconnect.';
		case 'BAD_NAME':
			return 'Pick a name first.';
		case 'BAD_VERSION':
			return 'This page is out of date — reload to get the latest version.';
		case 'SET_ALREADY_RESOLVED':
			return 'Too late — that set was just declared.';
		case 'NOT_YOUR_TURN':
			return "It's not your turn.";
		case 'TARGET_HAS_NO_CARDS':
			return 'They have no cards left.';
		case 'NOT_HOLDING_SET':
			return 'You need a card from that set to ask for one.';
		case 'ANTI_DECLARE_DISABLED':
			return 'Anti-declare is switched off for this game.';
		default:
			return fallback;
	}
}
