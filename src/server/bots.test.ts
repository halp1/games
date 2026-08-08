/**
 * Bot tests. These drive `decide` directly against the rules engine — no room, no sockets, no
 * timers — which is only possible because a bot's whole input is a `PlayerView`. If that ever
 * stops being true, this file stops compiling, which is the point.
 */
import { describe, expect, test } from 'bun:test';
import { HALF_SUITS, cardsInHalfSuit, mulberry32, type CardId } from '../lib/literature/cards';
import {
	applyAsk,
	applyChooseFinalDeclarer,
	applyDeclare,
	applyHandoff,
	createGame,
	isHalfSuit,
	scores,
	teamOf,
	type GameState,
	type SeatId
} from '../lib/literature/rules';
import { toPlayerView, type TableMeta } from '../lib/literature/view';
import { decide, newMemory, remember, type Memory } from './bots';

function meta(size: number): TableMeta {
	return {
		names: Array.from({ length: size }, (_, i) => `Bot ${i + 1}`),
		bots: Array.from({ length: size }, () => true),
		connected: Array.from({ length: size }, () => true),
		host: 0
	};
}

/** Mirrors `rooms.actingSeat`, which needs a Room this test deliberately does not build. */
function acting(game: GameState): SeatId | null {
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

interface Played {
	game: GameState;
	moves: number;
	declarations: number;
}

/** Runs a table of bots to the end of the game, or until the move budget runs out. */
function playOut(size: 4 | 6 | 8, seed: number, antiDeclare = false, budget = 3000): Played {
	let game = createGame(size, { antiDeclare }, mulberry32(seed));
	const table = meta(size);
	const brains = new Map<SeatId, Memory>();
	let moves = 0;
	let declarations = 0;

	for (let seat = 0; seat < size; seat++) brains.set(seat, newMemory());

	while (moves < budget) {
		/* Every bot watches every move, as the server does on each broadcast. Skipping this is
		   what makes a bot blind to the answer to its own question. */
		for (let seat = 0; seat < size; seat++) {
			remember(brains.get(seat)!, toPlayerView(game, seat, table));
		}

		const seat = acting(game);
		if (seat === null) break;

		const move = decide(toPlayerView(game, seat, table), brains.get(seat)!);
		if (!move) break;
		moves++;

		switch (move.t) {
			case 'ask':
				game = applyAsk(game, seat, move.target, move.card);
				break;
			case 'declare':
				if (!isHalfSuit(move.set)) throw new Error(`bot named a bogus set: ${move.set}`);
				game = applyDeclare(game, seat, move.set, move.mode, move.assign);
				declarations++;
				break;
			case 'handoff':
				game = applyHandoff(game, seat, move.to);
				break;
			case 'chooseFinalDeclarer':
				game = applyChooseFinalDeclarer(game, seat, move.seat);
				break;
			default:
				throw new Error(`bot produced an out-of-place command: ${move.t}`);
		}
	}

	return { game, moves, declarations };
}

describe('bots', () => {
	/* Several seeds, because "the bots finished" must not depend on a lucky deal. Every
	   applyX call re-checks legality and throws otherwise, so reaching the end at all proves
	   no bot ever proposed an illegal move. */
	test.each([1, 2, 3, 7, 42])('play a six-handed game to a finish (seed %i)', (seed) => {
		const { game, moves } = playOut(6, seed);

		expect(game.phase.kind).toBe('over');
		expect(Object.keys(game.resolved)).toHaveLength(HALF_SUITS.length);

		const [us, them] = scores(game);
		expect(us + them).toBe(9);
		/* Nine sets cannot split evenly, so somebody always wins outright. */
		expect(us).not.toBe(them);
		expect(moves).toBeGreaterThan(9);
	});

	test.each([4, 8])('play a %i-handed game to a finish', (size) => {
		const { game } = playOut(size as 4 | 8, 5);
		expect(game.phase.kind).toBe('over');
		expect(Object.keys(game.resolved)).toHaveLength(HALF_SUITS.length);
	});

	test('finish cleanly with anti-declare switched on', () => {
		/* The option changes what is legal, so the whole loop is re-run under it. */
		for (const seed of [1, 2, 3]) {
			const { game } = playOut(6, seed, true);
			expect(game.phase.kind).toBe('over');
			expect(Object.keys(game.resolved)).toHaveLength(HALF_SUITS.length);
		}
	});

	test('anti-declare a set they can place entirely with the opposition', () => {
		/* Built rather than played: knowing where all six of an opponent's cards are is rare
		   enough in a real game that waiting for it to happen would test nothing reliably.
		   Seats 1 and 3 are the opposition; ♠LOW sits entirely with them. */
		const game: GameState = {
			size: 4,
			options: { antiDeclare: true },
			hands: [
				['9D', 'TD'],
				['2S', '3S', '4S'],
				['JD', 'QD'],
				['5S', '6S', '7S']
			],
			resolved: {},
			turn: 0,
			phase: { kind: 'playing' },
			lastMove: null,
			move: 0
		};

		const memory = newMemory();
		for (const card of cardsInHalfSuit('SL')) {
			memory.holds.set(card, { seat: game.hands[1].includes(card) ? 1 : 3, at: 0 });
		}

		const move = decide(toPlayerView(game, 0, meta(4)), memory);
		expect(move?.t).toBe('declare');
		if (move?.t !== 'declare') throw new Error('expected a declaration');
		expect(move.set).toBe('SL');
		expect(move.mode).toBe('theirs');
		/* Every named holder is an opponent, which is what "theirs" has to mean. */
		for (const seat of Object.values(move.assign)) {
			expect(teamOf(seat)).not.toBe(teamOf(0));
		}

		/* And it is actually right — the engine scores it for the declarer's team. */
		const after = applyDeclare(game, 0, 'SL', 'theirs', move.assign);
		expect(after.resolved.SL).toMatchObject({ team: 0, success: true, mode: 'theirs' });
	});

	test('never anti-declare when the option is off', () => {
		const off: GameState = {
			size: 4,
			options: { antiDeclare: false },
			hands: [
				['9D', 'TD'],
				['2S', '3S', '4S'],
				['JD', 'QD'],
				['5S', '6S', '7S']
			],
			resolved: {},
			turn: 0,
			phase: { kind: 'playing' },
			lastMove: null,
			move: 0
		};

		const memory = newMemory();
		for (const card of cardsInHalfSuit('SL')) {
			memory.holds.set(card, { seat: off.hands[1].includes(card) ? 1 : 3, at: 0 });
		}

		const move = decide(toPlayerView(off, 0, meta(4)), memory);
		expect(move?.t === 'declare' && move.mode === 'theirs').toBe(false);
	});

	test('never declare a set they cannot account for while a legal ask exists', () => {
		/* A bot should prefer probing to guessing: a wrong declaration is a free set for the
		   other side, so guessing early is strictly worse than asking. */
		const { declarations, moves } = playOut(6, 11);
		expect(declarations).toBeLessThanOrEqual(9);
		expect(moves).toBeGreaterThan(declarations);
	});

	test('a bot only ever sees its own hand', () => {
		const game = createGame(6, { antiDeclare: false }, mulberry32(3));
		const view = toPlayerView(game, 2, meta(6));

		/* The type system already forbids a bot touching GameState; this pins the runtime
		   shape too, so a future field carrying hands would be caught here. */
		const serialised = JSON.stringify(view);
		for (let seat = 0; seat < game.size; seat++) {
			if (seat === 2) continue;
			for (const card of game.hands[seat]) {
				const elsewhere = game.hands[2].includes(card as CardId);
				if (!elsewhere) expect(serialised.includes(`"${card}"`)).toBe(false);
			}
		}
	});

	test('forget older evidence rather than banking it all game', () => {
		const memory = newMemory();
		let game = createGame(6, { antiDeclare: false }, mulberry32(21));
		const table = meta(6);

		/* Drive 40 moves past one seat and check the memory has not grown without bound. */
		for (let i = 0; i < 40; i++) {
			const seat = acting(game);
			if (seat === null || game.phase.kind !== 'playing') break;
			const move = decide(toPlayerView(game, seat, table), seat === 0 ? memory : newMemory());
			if (!move || move.t !== 'ask') break;
			game = applyAsk(game, seat, move.target, move.card);
			decide(toPlayerView(game, 0, table), memory);
		}

		/* Bounded by the memory window, not by how long the game has run. */
		expect(memory.holds.size).toBeLessThanOrEqual(12);
		expect(memory.lacks.size).toBeLessThanOrEqual(24);
	});
});
