import { describe, expect, test } from 'bun:test';
import {
	DECK_SIZE,
	HALF_SUITS,
	TABLE_SIZES,
	cardsInHalfSuit,
	deal,
	dealIsBalanced,
	halfSuitOf,
	handSizes,
	makeDeck,
	mulberry32,
	sortHand,
	type CardId,
	type TableSize
} from './cards';
import {
	applyAsk,
	applyChooseFinalDeclarer,
	applyDeclare,
	applyHandoff,
	askableCards,
	askableTargets,
	canAsk,
	canDeclare,
	canHandoff,
	createGame,
	handoffTargets,
	holderOf,
	hasLegalAsk,
	isCard,
	scores,
	teamOf,
	unresolvedSets,
	winner,
	type Assignment,
	type GameState,
	type SeatId
} from './rules';
import { cardsReachableIn, toPlayerView, type TableMeta } from './view';

/* ------------------------------------------------------------------ helpers */

/** Builds an explicit position. The engine never assumes a full deck is in play. */
function mk(size: TableSize, hands: CardId[][], over: Partial<GameState> = {}): GameState {
	return {
		size,
		options: { antiDeclare: false },
		hands: Array.from({ length: size }, (_, seat) => [...(hands[seat] ?? [])]),
		resolved: {},
		turn: 0,
		phase: { kind: 'playing' },
		lastMove: null,
		move: 0,
		...over
	};
}

/** Assigns each card of a half-suit to whichever seat actually holds it. */
function truthful(state: GameState, set: (typeof HALF_SUITS)[number]): Assignment {
	const assign: Assignment = {};
	for (const card of cardsInHalfSuit(set)) {
		assign[card] = state.hands.findIndex((hand) => hand.includes(card));
	}
	return assign;
}

function meta(size: number): TableMeta {
	return {
		names: Array.from({ length: size }, (_, i) => `P${i}`),
		bots: Array.from({ length: size }, () => false),
		connected: Array.from({ length: size }, () => true),
		host: 0
	};
}

const SPADES_LOW = ['2S', '3S', '4S', '5S', '6S', '7S'];

/**
 * A realistic mid-game six-handed position, so the redaction tests run against populated
 * `lastMove`, `resolved` and `truth` structures rather than a fresh deal.
 *
 * The driver is deliberately omniscient — it asks whoever actually holds the card. This is a
 * fixture for producing a *position*, not a bot: a blind driver plateaus around three cards
 * per set, because opponents break your sets up as fast as you build them, and then no set
 * ever resolves and the tests silently assert nothing.
 */
function playedOut(): GameState {
	let game = createGame(6, { antiDeclare: false }, mulberry32(9));

	/* Three sets is enough to populate every structure while leaving 36 cards in hands. */
	while (Object.keys(game.resolved).length < 3 && game.phase.kind === 'playing') {
		const seat = game.turn;
		const team = teamOf(seat);

		/* Declare once the whole *team* holds a set, not just this seat — a set split with a
		   teammate can never be completed by asking, since you may not ask your own side. */
		const complete = unresolvedSets(game).find((set) =>
			cardsInHalfSuit(set).every((card) => teamOf(holderOf(game, card)) === team)
		);
		if (complete) {
			const assign: Assignment = {};
			for (const card of cardsInHalfSuit(complete)) assign[card] = holderOf(game, card);
			game = applyDeclare(game, seat, complete, 'ours', assign);
			continue;
		}

		/* Only opponents may be asked, so skip anything a teammate is sitting on. */
		const want = askableCards(game, seat).find((card) => {
			const holder = holderOf(game, card);
			return holder >= 0 && canAsk(game, seat, holder, card) === null;
		});
		if (!want) break;
		game = applyAsk(game, seat, holderOf(game, want), want);
	}

	/* Leave an ask in the banner, so the last-move branch of the allowlist is exercised too. */
	if (game.phase.kind === 'playing') {
		const want = askableCards(game, game.turn)[0];
		const targets = askableTargets(game, game.turn);
		if (want && targets.length) game = applyAsk(game, game.turn, targets[0], want);
	}

	return game;
}

/** Four players, ♠LOW split across team 0, plus a spare card each so nobody is emptied. */
function spadesFixture() {
	return mk(4, [
		['2S', '3S', '4S', '9D'],
		['5H', '6H', 'TC'],
		['5S', '6S', '7S'],
		['7H', 'JC']
	]);
}

/* ------------------------------------------------------------------ deck */

describe('deck', () => {
	test('is 54 distinct cards', () => {
		const deck = makeDeck();
		expect(deck).toHaveLength(DECK_SIZE);
		expect(new Set(deck).size).toBe(DECK_SIZE);
	});

	test('the nine half-suits partition it exactly', () => {
		expect(HALF_SUITS).toHaveLength(9);
		const seen = new Set<CardId>();
		for (const set of HALF_SUITS) {
			const cards = cardsInHalfSuit(set);
			expect(cards).toHaveLength(6);
			for (const card of cards) {
				expect(seen.has(card)).toBe(false);
				seen.add(card);
				expect(halfSuitOf(card)).toBe(set);
			}
		}
		expect(seen.size).toBe(DECK_SIZE);
		expect([...seen].sort()).toEqual(makeDeck().sort());
	});

	test('the ninth set is the four eights plus both jokers', () => {
		expect(cardsInHalfSuit('EIGHTS').sort()).toEqual(['8C', '8D', '8H', '8S', 'XB', 'XR']);
	});

	test('sortHand groups by half-suit', () => {
		const sorted = sortHand(['AH', '2S', 'XR', '3S', '9H']);
		expect(sorted).toEqual(['2S', '3S', '9H', 'AH', 'XR']);
	});
});

/* ------------------------------------------------------------------ dealing */

describe('dealing', () => {
	test.each([...TABLE_SIZES])('%i players: every card dealt once', (size) => {
		const hands = deal(size, mulberry32(7));
		expect(hands.map((hand) => hand.length)).toEqual(handSizes(size));
		const all = hands.flat();
		expect(all).toHaveLength(DECK_SIZE);
		expect(new Set(all).size).toBe(DECK_SIZE);
	});

	test.each([...TABLE_SIZES])('%i players: both teams get exactly 27 cards', (size) => {
		expect(dealIsBalanced(size)).toBe(true);

		const hands = deal(size, mulberry32(size));
		const perTeam = [0, 0];
		hands.forEach((hand, seat) => (perTeam[teamOf(seat)] += hand.length));
		expect(perTeam).toEqual([27, 27]);
	});

	test('the remainder is even at every supported size, which is why teams stay level', () => {
		for (const size of TABLE_SIZES) expect((DECK_SIZE % size) % 2).toBe(0);
	});

	test('a new game starts with nine sets open and the dealer to act', () => {
		const game = createGame(6, { antiDeclare: false }, mulberry32(1));
		expect(game.turn).toBe(0);
		expect(game.phase.kind).toBe('playing');
		expect(scores(game)).toEqual([0, 0]);
		expect(game.hands.flat()).toHaveLength(DECK_SIZE);
	});
});

/* ------------------------------------------------------------------ asking */

describe('asking', () => {
	test('a hit moves the card and keeps the turn', () => {
		const before = mk(4, [['2S'], ['3S'], [], []]);
		const after = applyAsk(before, 0, 1, '3S');

		expect(after.hands[0]).toContain('3S');
		expect(after.hands[1]).not.toContain('3S');
		expect(after.turn).toBe(0);
		expect(after.lastMove).toMatchObject({ kind: 'ask', hit: true, card: '3S' });
	});

	test('a miss moves nothing and passes the turn to the player asked', () => {
		const before = mk(4, [['2S'], ['9H'], [], []]);
		const after = applyAsk(before, 0, 1, '3S');

		expect(after.hands[0]).toEqual(['2S']);
		expect(after.hands[1]).toEqual(['9H']);
		expect(after.turn).toBe(1);
		expect(after.lastMove).toMatchObject({ kind: 'ask', hit: false });
	});

	test('rejects every illegal ask', () => {
		const state = mk(4, [['2S'], ['9H'], ['AC'], []]);

		expect(canAsk(state, 1, 0, '3S')).toBe('NOT_YOUR_TURN');
		expect(canAsk(state, 0, 2, '3S')).toBe('TARGET_IS_TEAMMATE');
		expect(canAsk(state, 0, 3, '3S')).toBe('TARGET_HAS_NO_CARDS');
		expect(canAsk(state, 0, 9, '3S')).toBe('SEAT_NOT_AT_TABLE');
		expect(canAsk(state, 0, 1, 'ZZ')).toBe('UNKNOWN_CARD');
		expect(canAsk(state, 0, 1, '2S')).toBe('ALREADY_HOLD_CARD');
		/* Nothing in ♥HIGH, so ♥HIGH may not be probed. */
		expect(canAsk(state, 0, 1, 'KH')).toBe('NOT_HOLDING_SET');
		/* And a legal one, so the above are not passing for the wrong reason. */
		expect(canAsk(state, 0, 1, '3S')).toBeNull();
	});

	test('a resolved set can never be asked about again', () => {
		const state = spadesFixture();
		const resolved = applyDeclare(state, 0, 'SL', 'ours', truthful(state, 'SL'));
		expect(canAsk(resolved, resolved.turn, 1, '2S')).toBe('SET_ALREADY_RESOLVED');
	});

	test('holding only complete sets leaves no legal ask, but declaring is still open', () => {
		const state = mk(4, [SPADES_LOW, ['9H'], [], []]);

		expect(askableCards(state, 0)).toEqual([]);
		expect(hasLegalAsk(state, 0)).toBe(false);
		expect(canDeclare(state, 0, 'SL', 'ours', truthful(state, 'SL'))).toBeNull();
	});
});

/* ------------------------------------------------------------------ declaring */

describe('declaring', () => {
	test('a correct declaration scores for the declarer and clears the cards', () => {
		const before = spadesFixture();
		const after = applyDeclare(before, 0, 'SL', 'ours', truthful(before, 'SL'));

		expect(after.resolved.SL).toMatchObject({ team: 0, success: true });
		expect(scores(after)).toEqual([1, 0]);
		for (const card of SPADES_LOW) expect(after.hands.flat()).not.toContain(card);
	});

	test('naming the wrong teammate hands the set to the opposition', () => {
		const before = spadesFixture();
		const assign = { ...truthful(before, 'SL'), '5S': 0 }; // seat 2 actually holds it
		const after = applyDeclare(before, 0, 'SL', 'ours', assign);

		expect(after.resolved.SL).toMatchObject({ team: 1, success: false });
		expect(scores(after)).toEqual([0, 1]);
	});

	test('an opponent holding any card hands the set to the opposition', () => {
		/* 7S sits with seat 1, so no all-on-my-team assignment can be right. */
		const before = mk(4, [['2S', '3S', '4S', '9D'], ['5H', '7S'], ['5S', '6S'], ['7H']]);
		const assign: Assignment = { '2S': 0, '3S': 0, '4S': 0, '5S': 2, '6S': 2, '7S': 2 };
		const after = applyDeclare(before, 0, 'SL', 'ours', assign);

		expect(after.resolved.SL).toMatchObject({ team: 1, success: false });
		/* The truth is revealed either way. */
		expect(after.resolved.SL?.truth['7S']).toBe(1);
	});

	test('it can be made at any time, not only on your turn', () => {
		const before = spadesFixture();
		expect(before.turn).toBe(0);
		const after = applyDeclare(before, 2, 'SL', 'ours', truthful(before, 'SL'));
		expect(after.resolved.SL).toMatchObject({ team: 0, success: true });
	});

	test('losing the race to an already-resolved set is a clean rejection', () => {
		const before = spadesFixture();
		const after = applyDeclare(before, 0, 'SL', 'ours', truthful(before, 'SL'));
		expect(canDeclare(after, 2, 'SL', 'ours', truthful(before, 'SL'))).toBe('SET_ALREADY_RESOLVED');
	});

	test('rejects malformed assignments', () => {
		const state = spadesFixture();
		const good = truthful(state, 'SL');

		expect(canDeclare(state, 0, 'NOPE', 'ours', good)).toBe('UNKNOWN_SET');
		/* Five of six cards. */
		const short = { ...good };
		delete short['7S'];
		expect(canDeclare(state, 0, 'SL', 'ours', short)).toBe('BAD_ASSIGNMENT');
		/* Seat 1 is an opponent, so it cannot appear in an "ours" declaration. */
		expect(canDeclare(state, 0, 'SL', 'ours', { ...good, '7S': 1 })).toBe('BAD_ASSIGNMENT');
		expect(canDeclare(state, 0, 'SL', 'ours', { ...good, '7S': 99 })).toBe('BAD_ASSIGNMENT');
	});
});

/* ------------------------------------------------------------------ anti-declare */

describe('anti-declare', () => {
	/** ♠LOW entirely with team 1, which is what an anti-declare is for. */
	function fixture(antiDeclare: boolean) {
		return mk(4, [['9D'], ['2S', '3S', '4S'], ['TC'], ['5S', '6S', '7S']], {
			options: { antiDeclare }
		});
	}

	test('is refused when the option is off', () => {
		const state = fixture(false);
		expect(canDeclare(state, 0, 'SL', 'theirs', truthful(state, 'SL'))).toBe(
			'ANTI_DECLARE_DISABLED'
		);
	});

	test('steals the set when correct', () => {
		const before = fixture(true);
		const after = applyDeclare(before, 0, 'SL', 'theirs', truthful(before, 'SL'));

		expect(after.resolved.SL).toMatchObject({ team: 0, success: true, mode: 'theirs' });
		expect(scores(after)).toEqual([1, 0]);
	});

	test('gifts the set when wrong, exactly like a failed declaration', () => {
		const before = fixture(true);
		const assign = { ...truthful(before, 'SL'), '5S': 1 }; // seat 3 actually holds it
		const after = applyDeclare(before, 0, 'SL', 'theirs', assign);

		expect(after.resolved.SL).toMatchObject({ team: 1, success: false });
		expect(scores(after)).toEqual([0, 1]);
	});

	test('may only name opponents', () => {
		const state = fixture(true);
		const assign = { ...truthful(state, 'SL'), '5S': 0 };
		expect(canDeclare(state, 0, 'SL', 'theirs', assign)).toBe('BAD_ASSIGNMENT');
	});
});

/* ------------------------------------------------------------------ handoff */

describe('turn handoff', () => {
	/** Six players so team 0 survives seat 0 and seat 2 both being emptied. */
	function fixture() {
		return mk(6, [['2S', '3S', '4S'], ['9H'], ['5S', '6S', '7S'], ['TH'], ['9D'], ['JH']]);
	}

	test('a declaration that empties the turn-holder parks the game on a handoff', () => {
		const before = fixture();
		const after = applyDeclare(before, 0, 'SL', 'ours', truthful(before, 'SL'));

		expect(after.hands[0]).toEqual([]);
		expect(after.phase).toEqual({ kind: 'awaiting_handoff', seat: 0 });
		/* Seat 2 was emptied by the same declaration, so only seat 4 can take it. */
		expect(handoffTargets(after, 0)).toEqual([4]);
	});

	test('the turn passes to the chosen teammate and play resumes', () => {
		const parked = applyDeclare(fixture(), 0, 'SL', 'ours', truthful(fixture(), 'SL'));
		const after = applyHandoff(parked, 0, 4);

		expect(after.turn).toBe(4);
		expect(after.phase.kind).toBe('playing');
		expect(after.lastMove).toMatchObject({ kind: 'handoff', from: 0, to: 4 });
	});

	test('rejects handing off to yourself, an opponent, or an empty hand', () => {
		const parked = applyDeclare(fixture(), 0, 'SL', 'ours', truthful(fixture(), 'SL'));

		expect(canHandoff(parked, 0, 0)).toBe('BAD_HANDOFF_TARGET');
		expect(canHandoff(parked, 0, 1)).toBe('BAD_HANDOFF_TARGET');
		expect(canHandoff(parked, 0, 2)).toBe('BAD_HANDOFF_TARGET');
		expect(canHandoff(parked, 0, 4)).toBeNull();
	});
});

/* ------------------------------------------------------------------ endgame */

describe('endgame', () => {
	test('a team running out ends asking and hands the rest to the survivors', () => {
		/* Team 1 holds only ♠LOW; declaring it away leaves them with nothing. */
		const before = mk(4, [['9D'], ['2S', '3S', '4S'], ['TC'], ['5S', '6S', '7S']], {
			options: { antiDeclare: true }
		});
		const after = applyDeclare(before, 0, 'SL', 'theirs', truthful(before, 'SL'));

		expect(after.hands[1]).toEqual([]);
		expect(after.hands[3]).toEqual([]);
		expect(after.phase).toEqual({ kind: 'final_declarations', declarer: 0 });
		expect(canAsk(after, 0, 1, '9H')).toBe('ASKING_DISABLED');
	});

	test('when the turn sits with the eliminated team, they nominate a declarer', () => {
		const before = mk(4, [['9D'], ['2S', '3S', '4S'], ['TC'], ['5S', '6S', '7S']], {
			options: { antiDeclare: true },
			turn: 1
		});
		const after = applyDeclare(before, 0, 'SL', 'theirs', truthful(before, 'SL'));

		expect(after.phase).toEqual({ kind: 'choosing_final_declarer', chooser: 1 });
		/* Nobody declares while the table waits on the nomination. */
		expect(canDeclare(after, 0, 'DH', 'ours', {})).toBe('DECLARING_DISABLED');

		const chosen = applyChooseFinalDeclarer(after, 1, 2);
		expect(chosen.phase).toEqual({ kind: 'final_declarations', declarer: 2 });
		expect(chosen.turn).toBe(2);
	});

	test('the closing run belongs to one player, and only in "ours" mode', () => {
		const before = mk(4, [['9D'], ['2S', '3S', '4S'], ['TC'], ['5S', '6S', '7S']], {
			options: { antiDeclare: true }
		});
		const after = applyDeclare(before, 0, 'SL', 'theirs', truthful(before, 'SL'));

		expect(canDeclare(after, 2, 'DH', 'ours', {})).toBe('NOT_THE_DECLARER');
		expect(canDeclare(after, 0, 'DH', 'theirs', {})).toBe('BAD_ASSIGNMENT');
	});

	test('the game ends when the ninth set resolves, and cannot be drawn', () => {
		/* Eight already resolved 4–4, with ♠LOW left to break it. */
		const resolved: GameState['resolved'] = {};
		HALF_SUITS.filter((set) => set !== 'SL').forEach((set, i) => {
			resolved[set] = {
				team: (i % 2) as 0 | 1,
				declarer: 0,
				mode: 'ours',
				success: true,
				truth: {}
			};
		});

		const before = mk(4, [['2S', '3S', '4S'], [], ['5S', '6S', '7S'], []], { resolved });
		expect(scores(before)).toEqual([4, 4]);

		const after = applyDeclare(before, 0, 'SL', 'ours', truthful(before, 'SL'));
		expect(after.phase).toEqual({ kind: 'over' });
		expect(scores(after)).toEqual([5, 4]);
		expect(winner(after)).toBe(0);
	});
});

/* ------------------------------------------------------------------ redaction */

describe('redaction', () => {
	test('a view carries your own hand and nobody else’s', () => {
		const game = createGame(6, { antiDeclare: false }, mulberry32(42));
		const view = toPlayerView(game, 2, meta(6));

		expect(view.hand.sort()).toEqual([...game.hands[2]].sort());
		expect(view.seats.map((seat) => seat.cards)).toEqual(game.hands.map((hand) => hand.length));
	});

	test('nothing in a view maps a card to another player’s hand', () => {
		const game = playedOut();

		for (let seat: SeatId = 0; seat < game.size; seat++) {
			const view = toPlayerView(game, seat, meta(6));

			expect(view.hand.sort()).toEqual([...game.hands[seat]].sort());

			/* `truth` maps are the only card→seat structures on the wire. They are populated
			   only when a set resolves, and a resolved set's cards are in nobody's hand — so a
			   truth entry can never disclose a live holding. */
			const truths = [
				...view.resolved.map((entry) => entry.truth),
				...(view.lastMove?.kind === 'declare' ? [view.lastMove.truth] : [])
			];
			expect(truths.length).toBeGreaterThan(0);
			for (const truth of truths) {
				for (const card of Object.keys(truth)) {
					expect(game.hands.flat()).not.toContain(card);
				}
			}
		}
	});

	test('a view mentions no card outside what the table already knows', () => {
		const game = playedOut();

		for (let seat: SeatId = 0; seat < game.size; seat++) {
			const view = toPlayerView(game, seat, meta(6));

			/* Everything a player is entitled to hear. Anything else appearing in the payload —
			   an opponent's hand slipping into a new field, say — fails this. */
			const public_ = new Set<CardId>([
				...game.hands[seat], // your own hand
				...askableCards(game, seat), // cards you may legally name, derived from your hand
				...view.resolved.flatMap((entry) => cardsInHalfSuit(entry.set)), // out of play
				...(view.lastMove?.kind === 'ask' ? [view.lastMove.card] : []) // the ask, heard aloud
			]);

			const mentioned = [...cardsReachableIn(view)].filter(isCard);
			expect(mentioned.filter((card) => !public_.has(card))).toEqual([]);
		}
	});

	test('affordances are gated by phase and seat', () => {
		const game = mk(4, [['2S'], ['9H'], ['AC'], ['KD']]);

		const onTurn = toPlayerView(game, 0, meta(4));
		expect(onTurn.yourTurn).toBe(true);
		expect(onTurn.canAsk).toBe(true);
		expect(onTurn.askableTargets).toEqual([1, 3]);

		const offTurn = toPlayerView(game, 1, meta(4));
		expect(offTurn.canAsk).toBe(false);
		expect(offTurn.askableCards).toEqual([]);
		/* But declaring is any-time, so it stays available off-turn. */
		expect(offTurn.canDeclare).toBe(true);
	});
});
