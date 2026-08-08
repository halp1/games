/**
 * Binds the game server to an existing HTTP server.
 *
 * This is the *only* transport wiring in the project, and dev, `vite preview` and production
 * all call it with their own server. That is what buys dev/prod parity: there is no second
 * code path that only runs when deployed.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { WS_PATH } from '../lib/literature/protocol';
import { scheduleBots } from './bots';
import { disconnect, handle, setRoomListener, sweep, type Connection, type Session } from './rooms';

/* Wired here rather than inside rooms.ts, so the room registry has no dependency on bots and
   the two can be reasoned about separately. */
setRoomListener(scheduleBots);

export { WS_PATH };

/** Lapsed seats, silent sockets and idle rooms are collected on this interval. */
const SWEEP_MS = 15_000;

/** No legitimate command is anywhere near this large. */
const MAX_PAYLOAD_BYTES = 64 * 1024;

export interface GameServer {
	close(): void;
}

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/**
 * Just enough of an HTTP server to hang an upgrade listener on. Typed structurally because
 * Vite hands over `http.Server | Http2SecureServer`, and production hands over a plain
 * `http.Server` — nothing here cares which.
 */
export interface UpgradableServer {
	on(event: 'upgrade', listener: UpgradeListener): unknown;
	off(event: 'upgrade', listener: UpgradeListener): unknown;
}

/**
 * Guards against attaching twice to the same server. Vite can re-run `configureServer`
 * across a restart, and a second set of listeners would deliver every message twice.
 */
const ATTACHED = Symbol.for('halp.games.literature.gameServer');

type Attachable = UpgradableServer & { [ATTACHED]?: GameServer };

export function attachGameServer(httpServer: UpgradableServer): GameServer {
	const host = httpServer as Attachable;
	const existing = host[ATTACHED];
	if (existing) return existing;

	const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

	const onUpgrade: UpgradeListener = (req, socket, head) => {
		let pathname: string;
		try {
			pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
		} catch {
			return;
		}

		/* Not ours — return without touching the socket. In dev, Vite's HMR WebSocket shares
		   this server on "/", and destroying unmatched upgrades here would kill hot reload.
		   Production closes genuinely unhandled upgrades in server.js instead, where nothing
		   else is listening. */
		if (pathname !== WS_PATH) return;

		wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
	};

	httpServer.on('upgrade', onUpgrade);

	wss.on('connection', (ws: WebSocket) => {
		const session: Session = {
			conn: connectionFor(ws),
			room: null,
			token: null,
			lastSeen: Date.now()
		};

		ws.on('message', (data) => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(String(data));
			} catch {
				/* Garbage in; nothing worth telling the client about. */
				return;
			}
			try {
				handle(session, parsed);
			} catch (error) {
				/* A thrown rule error means a command slipped past its own `can*` guard. Never
				   take the process down over one bad message. */
				console.error('[literature] command failed:', error);
			}
		});

		ws.on('close', () => disconnect(session));
		ws.on('error', () => disconnect(session));
	});

	const timer = setInterval(() => sweep(), SWEEP_MS);
	/* Never hold the process open on our account. */
	timer.unref?.();

	const server: GameServer = {
		close() {
			clearInterval(timer);
			httpServer.off('upgrade', onUpgrade);
			for (const client of wss.clients) client.terminate();
			wss.close();
			delete host[ATTACHED];
		}
	};

	host[ATTACHED] = server;
	return server;
}

function connectionFor(ws: WebSocket): Connection {
	return {
		send(msg) {
			if (ws.readyState !== ws.OPEN) return;
			ws.send(JSON.stringify(msg));
		},
		close() {
			try {
				ws.close();
			} catch {
				/* Already gone. */
			}
		}
	};
}
