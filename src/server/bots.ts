/**
 * Bot players.
 *
 * The fairness guarantee is structural rather than a promise: a bot decides using nothing but
 * the `PlayerView` its seat would send to a human. It has no reference to the room's hands.
 * Every function below takes a view, never a `GameState` — that is the whole design.
 *
 * Because the view carries only the most recent move and no history, a bot that wants to know
 * anything has to remember it, which is exactly where the memory model lives. It keeps roughly
 * the last ten moves of public evidence and then forgets, so it plays like an attentive human
 * rather than a perfect recorder. That matters: this game deliberately hides the move log to
 * make memory the skill, and a bot with total recall would quietly undo that.
 */
import { cardsInHalfSuit, halfSuitOf, type CardId, type HalfSuitId } from '../lib/literature/cards';
import type { ClientMsg } from '../lib/literature/protocol';
import type { Assignment, SeatId } from '../lib/literature/rules';
import type { PlayerView } from '../lib/literature/view';
import {
	actingSeat,
	applyGameCommand,
	isBotSeat,
	isPaused,
	playerViewFor,
	type Room
} from './rooms';

/**
 * How long *other people's* moves stay with a bot. The main knob on how sharp bots feel —
 * raise it and they start banking a whole game's worth of other players' questions, which is
 * precisely the advantage this game's no-log design is meant to deny them.
 */
const MEMORY_MOVES = 10;

/** A card visibly changing hands is a louder event than a question, and sticks around longer. */
const HOLDS_MEMORY_MOVES = MEMORY_MOVES * 2;

/** Long enough to read what just happened, short enough not to drag. */
const THINK_MIN_MS = 800;
const THINK_MAX_MS = 1500;

export interface Memory {
	/** Card → the seat last seen holding it, and the move that revealed it. */
	holds: Map<CardId, { seat: SeatId; at: number }>;
	/**
	 * "seat:card" pairs this bot asked for itself and was refused. Never lapses — remembering
	 * your own questions is the most basic thing a player does, and forgetting them is not
	 * charming imprecision, it is asking the same person for the same card all game.
	 */
	ownMisses: Set<string>;
	/** "seat:card" ruled out by watching someone else ask. Fades. */
	lacks: Map<string, number>;
	/** "seat:set" → the move that proved they hold something in that set. Fades. */
	inSet: Map<string, number>;
	/** The last move already folded in, so evidence is never counted twice. */
	seen: number;
}

/* Keyed by the room object, so a collected room takes its bots' memories with it. */
const memories = new WeakMap<Room, Map<SeatId, Memory>>();
const timers = new WeakMap<Room, ReturnType<typeof setTimeout>>();

const pairKey = (seat: SeatId, of: string) => `${seat}:${of}`;

/** A bot that has seen nothing yet. Exported so a test can drive `decide` without a room. */
export function newMemory(): Memory {
	return { holds: new Map(), ownMisses: new Set(), lacks: new Map(), inSet: new Map(), seen: -1 };
}

function memoryFor(room: Room, seat: SeatId): Memory {
	let perRoom = memories.get(room);
	if (!perRoom) {
		perRoom = new Map();
		memories.set(room, perRoom);
	}
	let memory = perRoom.get(seat);
	if (!memory) {
		memory = newMemory();
		perRoom.set(seat, memory);
	}
	return memory;
}

/* ---------------------------------------------------------------- memory */

/**
 * Folds the one move on the wire into what this bot knows, then lets old evidence lapse.
 *
 * Must be called for every bot on every snapshot, not just when it is that bot's turn. A bot
 * is only *consulted* on its turn, but the view carries just one move — so a bot that only
 * looked when asked to move would never see the result of its own question, and would go on
 * asking the same player for the same card forever. A human watching the table sees every
 * move; this is what gives a bot the same.
 */
export function remember(memory: Memory, view: PlayerView): void {
	const move = view.lastMove;
	if (move && view.move !== memory.seen) {
		if (move.kind === 'ask') {
			const set = halfSuitOf(move.card);
			/* Asking at all proves the asker holds something in the set and not this card. */
			memory.inSet.set(pairKey(move.asker, set), view.move);

			if (move.hit) {
				memory.holds.set(move.card, { seat: move.asker, at: view.move });
				memory.lacks.set(pairKey(move.target, move.card), view.move);
			} else {
				memory.lacks.set(pairKey(move.target, move.card), view.move);
				memory.lacks.set(pairKey(move.asker, move.card), view.move);
				/* Our own refused question — kept for good. */
				if (move.asker === view.you) memory.ownMisses.add(pairKey(move.target, move.card));
			}
		}
	}
	memory.seen = view.move;

	const cutoff = view.move - MEMORY_MOVES;
	const holdsCutoff = view.move - HOLDS_MEMORY_MOVES;
	for (const [card, fact] of memory.holds) if (fact.at < holdsCutoff) memory.holds.delete(card);
	for (const [key, at] of memory.lacks) if (at < cutoff) memory.lacks.delete(key);
	for (const [key, at] of memory.inSet) if (at < cutoff) memory.inSet.delete(key);

	/* Card counts are always public, so a seat with nothing cannot be holding anything —
	   cheap certainty that costs no memory. */
	for (const [card, fact] of memory.holds) {
		if (view.seats[fact.seat]?.cards === 0) memory.holds.delete(card);
	}
}

/** Who this bot believes holds a card, or null when it genuinely does not know. */
function believedHolder(view: PlayerView, memory: Memory, card: CardId): SeatId | null {
	if (view.hand.includes(card)) return view.you;
	return memory.holds.get(card)?.seat ?? null;
}

/* ---------------------------------------------------------------- choices */

/** A set whose six holders the bot believes it can name, all on one team. */
function findDeclaration(view: PlayerView, memory: Memory): ClientMsg | null {
	for (const set of view.unresolved) {
		const cards = cardsInHalfSuit(set);
		const holders = cards.map((card) => believedHolder(view, memory, card));
		if (holders.some((holder) => holder === null)) continue;

		const assign: Assignment = {};
		cards.forEach((card, index) => (assign[card] = holders[index]!));
		const teams = holders.map((holder) => view.seats[holder!].team);

		if (teams.every((team) => team === view.yourTeam)) {
			return { t: 'declare', set, mode: 'ours', assign };
		}
		if (view.options.antiDeclare && teams.every((team) => team !== view.yourTeam)) {
			return { t: 'declare', set, mode: 'theirs', assign };
		}
	}
	return null;
}

/**
 * A declaration the bot is *not* sure of, for when the rules leave it no choice — the endgame
 * run, or a hand where every set it holds is already complete so no ask is legal.
 */
function guessDeclaration(view: PlayerView, memory: Memory): ClientMsg | null {
	const set: HalfSuitId | undefined = view.unresolved[0];
	if (!set) return null;

	const mates = view.seats
		.filter((seat) => seat.team === view.yourTeam && seat.cards > 0)
		.map((seat) => seat.seat);
	const fallback = mates[0] ?? view.you;

	const assign: Assignment = {};
	for (const card of cardsInHalfSuit(set)) {
		const believed = believedHolder(view, memory, card);
		const usable = believed !== null && view.seats[believed].team === view.yourTeam;
		assign[card] = usable ? believed! : fallback;
	}
	return { t: 'declare', set, mode: 'ours', assign };
}

/**
 * Every (card, target) pair drawn from the view's own affordance lists is legal — card
 * legality depends only on the bot's hand, target legality only on team and card count — so
 * anything chosen here is safe to send.
 */
function chooseAsk(view: PlayerView, memory: Memory): ClientMsg | null {
	const targets = view.askableTargets;
	if (!targets.length || !view.askableCards.length) return null;

	/* Best case: someone was seen taking this exact card and still has cards. */
	for (const card of view.askableCards) {
		const fact = memory.holds.get(card);
		if (fact && targets.includes(fact.seat)) return { t: 'ask', target: fact.seat, card };
	}

	/* Otherwise probe where the bot is strongest — the more of a set it holds, the more
	   likely an opponent's card completes something worth having. */
	const strength = new Map<HalfSuitId, number>();
	for (const card of view.hand) {
		const set = halfSuitOf(card);
		strength.set(set, (strength.get(set) ?? 0) + 1);
	}
	const ranked = [...view.askableCards].sort(
		(a, b) => (strength.get(halfSuitOf(b)) ?? 0) - (strength.get(halfSuitOf(a)) ?? 0)
	);

	/* Own refusals are permanent, so a pair ruled out here stays ruled out. That is what makes
	   asking a strictly shrinking search: every question either wins a card or removes a
	   possibility for good, so a bot cannot probe forever. */
	const ruledOut = (seat: SeatId, card: CardId) =>
		memory.ownMisses.has(pairKey(seat, card)) || memory.lacks.has(pairKey(seat, card));

	for (const card of ranked) {
		const set = halfSuitOf(card);
		const viable = targets.filter((seat) => !ruledOut(seat, card));
		if (!viable.length) continue;

		/* Someone who has asked about this set is holding something in it. Failing that, the
		   fullest hand is the best raw odds. */
		const known = viable.filter((seat) => memory.inSet.has(pairKey(seat, set)));
		const shortlist = known.length ? known : viable;
		const target = shortlist.reduce(
			(best, seat) => (view.seats[seat].cards > view.seats[best].cards ? seat : best),
			shortlist[0]
		);
		return { t: 'ask', target, card };
	}

	/* Every opponent has been personally ruled out for every card this bot could ask for, so
	   there is nothing left to learn by asking — whatever is missing must be on its own side.
	   Returning null hands over to a declaration, which always resolves a set and therefore
	   always moves the game forward. */
	return null;
}

/** The move this bot would make, decided entirely from its own view of the table. */
export function decide(view: PlayerView, memory: Memory): ClientMsg | null {
	/* Idempotent — guarded by `memory.seen` — so calling it here as well as from the
	   per-snapshot sweep costs nothing and keeps `decide` correct when driven directly. */
	remember(memory, view);

	switch (view.phase.kind) {
		case 'awaiting_handoff': {
			const to = mostCards(view, view.handoffTargets);
			return to === null ? null : { t: 'handoff', to };
		}

		case 'choosing_final_declarer': {
			const choices = view.finalDeclarerChoices;
			/* Take it on if we can; we are as informed as anyone on our side. */
			const seat = choices.includes(view.you) ? view.you : mostCards(view, choices);
			return seat === null ? null : { t: 'chooseFinalDeclarer', seat };
		}

		case 'final_declarations':
			/* No asking left — every remaining set has to be called, sure of it or not. */
			return findDeclaration(view, memory) ?? guessDeclaration(view, memory);

		case 'playing': {
			const sure = findDeclaration(view, memory);
			if (sure) return sure;
			const ask = chooseAsk(view, memory);
			if (ask) return ask;
			/* Holding only complete sets leaves no legal ask, so a declaration is forced. */
			return guessDeclaration(view, memory);
		}

		case 'over':
			return null;
	}
}

function mostCards(view: PlayerView, seats: SeatId[]): SeatId | null {
	if (!seats.length) return null;
	return seats.reduce(
		(best, seat) => (view.seats[seat].cards > view.seats[best].cards ? seat : best),
		seats[0]
	);
}

/* ---------------------------------------------------------------- scheduling */

/**
 * Called after every broadcast. If the table is waiting on a bot, it thinks for a beat and
 * then moves, which broadcasts again and brings us back here — that loop is what drives a
 * bot-only table, and it ends when the game ends or a human's turn arrives.
 */
export function scheduleBots(room: Room): void {
	const pending = timers.get(room);
	if (pending) clearTimeout(pending);

	/* Every bot watches every move, exactly as a human at the table would. Doing this only
	   for the bot about to act would leave it blind to the answer to its own question. */
	for (let seat = 0; seat < room.size; seat++) {
		if (!isBotSeat(room, seat)) continue;
		const view = playerViewFor(room, seat);
		if (view) remember(memoryFor(room, seat), view);
	}

	if (isPaused(room)) return;
	const seat = actingSeat(room);
	if (seat === null || !isBotSeat(room, seat)) return;

	const delay = THINK_MIN_MS + Math.random() * (THINK_MAX_MS - THINK_MIN_MS);
	timers.set(
		room,
		setTimeout(() => {
			timers.delete(room);
			play(room, seat);
		}, delay)
	);
}

function play(room: Room, seat: SeatId): void {
	/* The position may have moved on while we were thinking — a human can declare at any
	   time, which is exactly the sort of thing that invalidates a queued bot move. */
	if (isPaused(room) || actingSeat(room) !== seat || !isBotSeat(room, seat)) return;

	const view = playerViewFor(room, seat);
	if (!view) return;

	const memory = memoryFor(room, seat);
	const move = decide(view, memory);
	if (!move) return;

	const error = applyGameCommand(room, seat, move);
	if (!error) return;

	/* A rejected bot move would stall the table, because nothing broadcasts and nothing
	   reschedules. Fall back to a move the server itself said was legal. */
	const card = view.askableCards[0];
	const target = view.askableTargets[0];
	if (card !== undefined && target !== undefined) {
		if (!applyGameCommand(room, seat, { t: 'ask', target, card })) return;
	}
	console.error(`[literature] bot at seat ${seat} could not move (${error})`);
}
