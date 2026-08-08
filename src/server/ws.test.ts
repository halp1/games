/**
 * Transport tests. These run against a real `http.Server` with real WebSocket clients, so
 * they exercise the same `attachGameServer` that dev, preview and production all call.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '../lib/literature/protocol';
import { WS_PATH, attachGameServer } from './ws';

let server: http.Server;
let port = 0;

beforeAll(async () => {
	server = http.createServer((_req, res) => {
		res.statusCode = 404;
		res.end();
	});
	attachGameServer(server);

	/* Stands in for Vite's HMR socket, which shares the dev server on "/". A real second
	   WebSocket server rather than a spy: coexistence is the property under test, and the
	   only way to prove it is to have both actually serve connections at once. */
	const hmrLike = new WebSocketServer({ noServer: true });
	hmrLike.on('connection', (ws: WebSocket) => ws.send('hmr'));
	server.on('upgrade', (req, socket, head) => {
		if (new URL(req.url ?? '/', 'http://localhost').pathname === WS_PATH) return;
		hmrLike.handleUpgrade(req, socket, head, (ws) => hmrLike.emit('connection', ws, req));
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(() => {
	server.close();
});

class Client {
	private queue: ServerMsg[] = [];
	private waiters: { t: string; resolve: (msg: ServerMsg) => void }[] = [];

	private constructor(private ws: WebSocket) {
		ws.on('message', (data) => {
			const msg = JSON.parse(String(data)) as ServerMsg;
			const index = this.waiters.findIndex((waiter) => waiter.t === msg.t);
			if (index >= 0) this.waiters.splice(index, 1)[0].resolve(msg);
			else this.queue.push(msg);
		});
	}

	static async open(): Promise<Client> {
		const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
		await new Promise<void>((resolve, reject) => {
			ws.once('open', () => resolve());
			ws.once('error', reject);
		});
		return new Client(ws);
	}

	send(msg: ClientMsg): void {
		this.ws.send(JSON.stringify(msg));
	}

	wait<T extends ServerMsg['t']>(t: T, timeoutMs = 2000): Promise<Extract<ServerMsg, { t: T }>> {
		const found = this.queue.findIndex((msg) => msg.t === t);
		if (found >= 0)
			return Promise.resolve(this.queue.splice(found, 1)[0] as Extract<ServerMsg, { t: T }>);

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`timed out waiting for "${t}"`)), timeoutMs);
			this.waiters.push({
				t,
				resolve: (msg) => {
					clearTimeout(timer);
					resolve(msg as Extract<ServerMsg, { t: T }>);
				}
			});
		});
	}

	close(): void {
		this.ws.close();
	}
}

const HELLO = { v: PROTOCOL_VERSION, size: 4, antiDeclare: false } as const;

describe('transport', () => {
	test('shares the port with another WebSocket server, as it must in dev', async () => {
		/* If attachGameServer destroyed upgrades it does not claim, this would hang or fail —
		   and hot reload would be broken in dev while everything looked fine in production. */
		const hmr = new WebSocket(`ws://127.0.0.1:${port}/`);
		const greeting = await new Promise<string>((resolve, reject) => {
			hmr.once('message', (data) => resolve(String(data)));
			hmr.once('error', reject);
		});
		expect(greeting).toBe('hmr');
		hmr.close();

		/* And our own path still works with the other server listening alongside. */
		const client = await Client.open();
		client.send({ t: 'ping' });
		expect((await client.wait('pong')).t).toBe('pong');
		client.close();
	});

	test('answers a ping', async () => {
		const client = await Client.open();
		client.send({ t: 'ping' });
		expect((await client.wait('pong')).t).toBe('pong');
		client.close();
	});

	test('creates a room and seats the host', async () => {
		const host = await Client.open();
		host.send({ t: 'create', ...HELLO, name: 'Josh' });

		const welcome = await host.wait('welcome');
		expect(welcome.room).toHaveLength(4);
		expect(welcome.seat).toBe(0);
		expect(welcome.token).toBeTruthy();

		const { view } = await host.wait('room');
		expect(view.stage).toBe('lobby');
		expect(view.isHost).toBe(true);
		expect(view.canStart).toBe(false);
		expect(view.seats.map((seat) => seat.name)).toEqual(['Josh', '', '', '']);
		host.close();
	});

	test('a second player joins by code and both sides see it', async () => {
		const host = await Client.open();
		host.send({ t: 'create', ...HELLO, name: 'Josh' });
		const code = (await host.wait('welcome')).room;
		await host.wait('room');

		const guest = await Client.open();
		guest.send({ t: 'join', v: PROTOCOL_VERSION, name: 'Amrita', room: code });

		expect((await guest.wait('welcome')).seat).toBe(1);
		expect((await guest.wait('room')).view.seats[1].name).toBe('Amrita');
		/* The host is told too, without having asked. */
		expect((await host.wait('room')).view.seats[1].name).toBe('Amrita');

		host.close();
		guest.close();
	});

	test('rejects an unknown room', async () => {
		const client = await Client.open();
		client.send({ t: 'join', v: PROTOCOL_VERSION, name: 'Josh', room: 'ZZZZ' });
		expect((await client.wait('error')).code).toBe('ROOM_NOT_FOUND');
		client.close();
	});

	test('rejects a mismatched protocol version', async () => {
		const client = await Client.open();
		client.send({
			t: 'create',
			v: PROTOCOL_VERSION + 1,
			name: 'Josh',
			size: 4,
			antiDeclare: false
		});
		expect((await client.wait('error')).code).toBe('BAD_VERSION');
		client.close();
	});

	test('a token reclaims the same seat after a dropped socket', async () => {
		const host = await Client.open();
		host.send({ t: 'create', ...HELLO, name: 'Josh' });
		const opened = await host.wait('welcome');
		await host.wait('room');

		const guest = await Client.open();
		guest.send({ t: 'join', v: PROTOCOL_VERSION, name: 'Amrita', room: opened.room });
		const guestWelcome = await guest.wait('welcome');
		await guest.wait('room');
		await host.wait('room');

		/* Simulate the phone locking: the socket dies without a goodbye. */
		guest.close();
		await host.wait('room');

		const again = await Client.open();
		again.send({
			t: 'join',
			v: PROTOCOL_VERSION,
			name: 'Amrita',
			room: opened.room,
			token: guestWelcome.token
		});

		const reclaimed = await again.wait('welcome');
		expect(reclaimed.seat).toBe(guestWelcome.seat);
		expect(reclaimed.token).toBe(guestWelcome.token);
		expect((await again.wait('room')).view.seats[1].connected).toBe(true);

		host.close();
		again.close();
	});

	test('fills the table with bots and starts a game', async () => {
		const host = await Client.open();
		host.send({ t: 'create', ...HELLO, name: 'Josh' });
		await host.wait('welcome');
		await host.wait('room');

		for (let i = 0; i < 3; i++) {
			host.send({ t: 'addBot' });
			await host.wait('room');
		}

		host.send({ t: 'start' });
		const { view } = await host.wait('room');

		expect(view.stage).toBe('game');
		expect(view.game).not.toBeNull();
		/* Four players share 54 cards as 14/14/13/13. */
		expect(view.game?.hand).toHaveLength(14);
		expect(view.game?.seats.map((seat) => seat.cards)).toEqual([14, 14, 13, 13]);
		/* And the host sees only their own cards. */
		expect(view.game?.seats.every((seat) => !('hand' in seat))).toBe(true);

		host.close();
	});

	test('refuses to start a half-empty table', async () => {
		const host = await Client.open();
		host.send({ t: 'create', ...HELLO, name: 'Josh' });
		await host.wait('welcome');
		await host.wait('room');

		host.send({ t: 'start' });
		expect((await host.wait('error')).code).toBe('SEATS_NOT_FULL');
		host.close();
	});

	test('non-hosts cannot drive the lobby', async () => {
		const host = await Client.open();
		host.send({ t: 'create', ...HELLO, name: 'Josh' });
		const code = (await host.wait('welcome')).room;
		await host.wait('room');

		const guest = await Client.open();
		guest.send({ t: 'join', v: PROTOCOL_VERSION, name: 'Amrita', room: code });
		await guest.wait('welcome');
		await guest.wait('room');

		guest.send({ t: 'addBot' });
		expect((await guest.wait('error')).code).toBe('NOT_HOST');

		host.close();
		guest.close();
	});
});
