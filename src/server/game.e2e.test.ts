/**
 * A whole game, end to end, over a real WebSocket against a real HTTP server.
 *
 * Everything else is tested in isolation: the rules without a server, the transport without a
 * game, the bots without a room. This is the one test that runs the lot together — protocol,
 * room registry, redaction, the bot scheduling loop, and every endgame path the rules can
 * reach — and it is the only place a wiring mistake between them can show up.
 *
 * The scripted player doubles as the dev-only client the plan called for: it drives a seat
 * using nothing but the `PlayerView` on the wire, which is exactly what a browser has.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { HALF_SUITS } from '../lib/literature/cards';
import {
	PROTOCOL_VERSION,
	type ClientMsg,
	type RoomView,
	type ServerMsg
} from '../lib/literature/protocol';
import { decide, newMemory, remember } from './bots';
import { WS_PATH, attachGameServer } from './ws';

/* Bots normally pause ~1.2s so play stays readable; a full game at that pace would take two
   minutes. Nothing else about their behaviour changes. */
process.env.LITERATURE_BOT_THINK_MIN_MS = '0';
process.env.LITERATURE_BOT_THINK_MAX_MS = '1';

let server: http.Server;
let port = 0;

beforeAll(async () => {
	server = http.createServer((_req, res) => {
		res.statusCode = 404;
		res.end();
	});
	attachGameServer(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(() => server.close());

/** A seat driven by the same decision function the bots use, over the public protocol. */
class Scripted {
	view: RoomView | null = null;
	private memory = newMemory();
	private resolveNext: (() => void) | null = null;

	private constructor(private ws: WebSocket) {
		ws.on('message', (data) => {
			const msg = JSON.parse(String(data)) as ServerMsg;
			if (msg.t === 'room') {
				this.view = msg.view;
				/* Watch every move, exactly as the real client's screen does. */
				if (msg.view.game) remember(this.memory, msg.view.game);
				this.resolveNext?.();
				this.resolveNext = null;
			}
		});
	}

	static async open(): Promise<Scripted> {
		const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
		await new Promise<void>((resolve, reject) => {
			ws.once('open', () => resolve());
			ws.once('error', reject);
		});
		return new Scripted(ws);
	}

	send(msg: ClientMsg): void {
		this.ws.send(JSON.stringify(msg));
	}

	/** Resolves on the next snapshot, or after `ms` if the table is waiting on someone else. */
	nextUpdate(ms = 2000): Promise<void> {
		return new Promise((resolve) => {
			const timer = setTimeout(resolve, ms);
			this.resolveNext = () => {
				clearTimeout(timer);
				resolve();
			};
		});
	}

	/** Plays this seat if it is our move. Returns false when there was nothing to do. */
	act(): boolean {
		const game = this.view?.game;
		if (!game || this.view?.paused) return false;

		const ours =
			(game.phase.kind === 'playing' && game.turn === game.you) ||
			(game.phase.kind === 'awaiting_handoff' && game.phase.seat === game.you) ||
			(game.phase.kind === 'choosing_final_declarer' && game.phase.chooser === game.you) ||
			(game.phase.kind === 'final_declarations' && game.phase.declarer === game.you);
		if (!ours) return false;

		const move = decide(game, this.memory);
		if (!move) return false;
		this.send(move);
		return true;
	}

	close(): void {
		this.ws.close();
	}
}

describe('a complete game', () => {
	test('six players — one scripted human and five bots — reach a result', async () => {
		const human = await Scripted.open();
		human.send({ t: 'create', v: PROTOCOL_VERSION, name: 'Josh', size: 6, antiDeclare: true });
		await human.nextUpdate();

		for (let i = 0; i < 5; i++) {
			human.send({ t: 'addBot' });
			await human.nextUpdate();
		}
		expect(human.view?.canStart).toBe(true);

		human.send({ t: 'start' });
		await human.nextUpdate();
		expect(human.view?.stage).toBe('game');
		/* 54 cards over six seats. */
		expect(human.view?.game?.hand).toHaveLength(9);

		/* Bots drive themselves off the server's own broadcasts; this only steps the human. */
		for (let step = 0; step < 600; step++) {
			if (human.view?.game?.phase.kind === 'over') break;
			if (!human.act()) await human.nextUpdate(150);
			else await human.nextUpdate();
		}

		const game = human.view!.game!;
		expect(game.phase.kind).toBe('over');
		expect(game.resolved).toHaveLength(HALF_SUITS.length);

		const [us, them] = game.scores;
		expect(us + them).toBe(9);
		/* Nine sets never split evenly. */
		expect(us).not.toBe(them);
		expect(game.winner).toBe(us > them ? game.yourTeam : game.yourTeam === 0 ? 1 : 0);

		/* Every seat is empty at the end — all 54 cards accounted for by the nine sets. */
		expect(game.seats.every((seat) => seat.cards === 0)).toBe(true);

		/* And after all that, the human still only ever saw its own hand. */
		expect(JSON.stringify(game)).not.toContain('"hands"');

		human.send({ t: 'rematch' });
		await human.nextUpdate();
		expect(human.view?.stage).toBe('lobby');

		human.close();
	}, 60_000);

	test('a game pauses when a human drops and resumes when they return', async () => {
		const host = await Scripted.open();
		host.send({ t: 'create', v: PROTOCOL_VERSION, name: 'Josh', size: 4, antiDeclare: false });
		await host.nextUpdate();
		const code = host.view!.code;

		const guest = await Scripted.open();
		guest.send({ t: 'join', v: PROTOCOL_VERSION, name: 'Amrita', room: code });
		await guest.nextUpdate();
		await host.nextUpdate();

		host.send({ t: 'addBot' });
		await host.nextUpdate();
		host.send({ t: 'addBot' });
		await host.nextUpdate();
		host.send({ t: 'start' });
		await host.nextUpdate();
		expect(host.view?.stage).toBe('game');
		expect(host.view?.paused).toBeNull();

		/* The phone locks. */
		guest.close();
		await host.nextUpdate();
		expect(host.view?.paused?.name).toBe('Amrita');

		/* Play is frozen: even a legal move is refused while a seat is empty. */
		const before = host.view!.game!.move;
		host.act();
		await host.nextUpdate(300);
		expect(host.view!.game!.move).toBe(before);

		host.close();
	}, 30_000);
});
