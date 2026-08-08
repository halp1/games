/**
 * The wire protocol. Imported by both the client and the server, so the two can never drift.
 *
 * The server replies to every command with a full `room` snapshot rather than a diff. A whole
 * snapshot is well under a kilobyte for a 54-card game, it makes reconnection trivial —
 * there is no history to replay, which is exactly what this game's memory rules want anyway —
 * and it removes a whole class of desync bugs. The client animates by diffing consecutive
 * snapshots, not by reading the wire.
 */
import type { CardId, HalfSuitId, TableSize } from './cards';
import type { Assignment, DeclareMode, GameOptions, SeatId, Team } from './rules';
import type { PlayerView } from './view';

export const PROTOCOL_VERSION = 1;

/**
 * Distinct from "/" so it never collides with Vite's HMR socket in dev — they share a port.
 */
export const WS_PATH = '/_ws';

/** Room codes avoid O/0 and I/1, which are the pairs people misread aloud. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

export const MAX_NAME_LENGTH = 14;

export type ClientMsg =
	| { t: 'create'; v: number; name: string; size: TableSize; antiDeclare: boolean }
	| { t: 'join'; v: number; name: string; room: string; token?: string }
	/* Lobby, host only. */
	| { t: 'setSize'; size: TableSize }
	| { t: 'setAntiDeclare'; on: boolean }
	| { t: 'shuffleSeats' }
	| { t: 'swapSeats'; a: SeatId; b: SeatId }
	| { t: 'addBot' }
	| { t: 'removeSeat'; seat: SeatId }
	| { t: 'start' }
	| { t: 'rematch' }
	/** Ends a game in progress and returns everyone to the lobby. Host only. */
	| { t: 'abandon' }
	/* In play. */
	| { t: 'ask'; target: SeatId; card: CardId }
	| { t: 'declare'; set: HalfSuitId; mode: DeclareMode; assign: Assignment }
	| { t: 'handoff'; to: SeatId }
	| { t: 'chooseFinalDeclarer'; seat: SeatId }
	| { t: 'leave' }
	| { t: 'ping' };

export type ServerMsg =
	/** Sent once on create/join. `token` is a secret — it is what reclaims this seat later. */
	| { t: 'welcome'; room: string; token: string; seat: SeatId }
	| { t: 'room'; view: RoomView }
	| { t: 'error'; code: ErrorCode; message: string }
	| { t: 'pong' };

export type ErrorCode =
	| 'BAD_MESSAGE'
	| 'BAD_VERSION'
	| 'ROOM_NOT_FOUND'
	| 'ROOM_FULL'
	| 'GAME_IN_PROGRESS'
	| 'NOT_IN_A_ROOM'
	| 'NOT_HOST'
	| 'NOT_IN_LOBBY'
	| 'SEATS_NOT_FULL'
	| 'GAME_NOT_STARTED'
	| 'GAME_PAUSED'
	| 'SEAT_TAKEN'
	| 'BAD_NAME'
	/* Anything the rules engine rejected keeps its own code — see `RuleError`. */
	| string;

export interface RoomSeat {
	seat: SeatId;
	team: Team;
	/** Empty string when the seat is still open. */
	name: string;
	filled: boolean;
	isBot: boolean;
	/** Bots are always "connected"; humans reflect their socket. */
	connected: boolean;
	isHost: boolean;
	isYou: boolean;
}

export interface RoomView {
	code: string;
	you: SeatId;
	stage: 'lobby' | 'game';
	size: TableSize;
	options: GameOptions;
	seats: RoomSeat[];
	isHost: boolean;
	canStart: boolean;
	/**
	 * Set while a human is away mid-game. Play freezes rather than continuing without them —
	 * Literature is pure deduction, and an auto-played turn would leak information.
	 */
	paused: { seat: SeatId; name: string } | null;
	/** Null in the lobby. Redacted for `you` and nobody else. */
	game: PlayerView | null;
}

export function isClientMsg(value: unknown): value is ClientMsg {
	return typeof value === 'object' && value !== null && typeof (value as ClientMsg).t === 'string';
}

/** Trims and bounds a display name. Returns null when nothing usable is left. */
export function cleanName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
	return name.length > 0 ? name : null;
}

export function cleanCode(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const code = raw.trim().toUpperCase();
	if (code.length !== CODE_LENGTH) return null;
	return [...code].every((ch) => CODE_ALPHABET.includes(ch)) ? code : null;
}
