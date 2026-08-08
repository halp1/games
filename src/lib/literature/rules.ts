/**
 * The Literature rules engine.
 *
 * Pure and synchronous: every `apply*` returns a new state and never touches the clock, the
 * network or a random source it was not handed. That is what lets the whole rule set be
 * tested without a server, and it is also why the any-time declare race is safe — the server
 * feeds commands through here one at a time with no `await` in between.
 *
 * House rules in force (see the plan for provenance):
 *   - 54-card deck, nine half-suits, so a majority is five and a draw is impossible.
 *   - A declaration may be made at any moment, not only on your turn.
 *   - Any error in a declaration hands the set to the opposing team.
 *   - Anti-declare (calling a set the *other* team holds) is an option, off by default.
 */
import {
	CARDS_PER_HALF_SUIT,
	HALF_SUITS,
	cardsInHalfSuit,
	deal,
	halfSuitOf,
	makeDeck,
	type CardId,
	type HalfSuitId,
	type Rng,
	type TableSize
} from './cards';

export type SeatId = number;
export type Team = 0 | 1;

/** Seats alternate, so a seat's parity *is* its team. Everything else follows from this. */
export function teamOf(seat: SeatId): Team {
	return (seat % 2) as Team;
}

export function otherTeam(team: Team): Team {
	return (1 - team) as Team;
}

export type DeclareMode = 'ours' | 'theirs';

/** Which seat is asserted to hold each of a half-suit's six cards. */
export type Assignment = Record<CardId, SeatId>;

export type Phase =
	/** Normal play: the turn-holder asks, anyone may declare. */
	| { kind: 'playing' }
	/** A declaration emptied the turn-holder's hand; they must pass the turn to a teammate. */
	| { kind: 'awaiting_handoff'; seat: SeatId }
	/** One team is out of cards and the turn sits with someone who cannot declare. */
	| { kind: 'choosing_final_declarer'; chooser: SeatId }
	/** One team is out; this player declares every remaining set alone. */
	| { kind: 'final_declarations'; declarer: SeatId }
	| { kind: 'over' };

/**
 * The single most recent move. There is deliberately no history — this game is played from
 * memory, so the server never retains or transmits anything older than this.
 */
export type LastMove =
	| { kind: 'ask'; asker: SeatId; target: SeatId; card: CardId; hit: boolean }
	| {
			kind: 'declare';
			declarer: SeatId;
			set: HalfSuitId;
			mode: DeclareMode;
			assign: Assignment;
			truth: Assignment;
			success: boolean;
			scoringTeam: Team;
	  }
	| { kind: 'handoff'; from: SeatId; to: SeatId };

export interface ResolvedSet {
	/** The team that scored it — not necessarily the declarer's. */
	team: Team;
	declarer: SeatId;
	mode: DeclareMode;
	success: boolean;
	/** Where the six cards actually were. Public once resolved, and shown on tap. */
	truth: Assignment;
}

export interface GameOptions {
	antiDeclare: boolean;
}

export interface GameState {
	size: TableSize;
	options: GameOptions;
	hands: CardId[][];
	resolved: Partial<Record<HalfSuitId, ResolvedSet>>;
	turn: SeatId;
	phase: Phase;
	lastMove: LastMove | null;
	/** Increments on every applied move. Drives the client's "something changed" animations. */
	move: number;
}

export type RuleError =
	| 'GAME_OVER'
	| 'NOT_YOUR_TURN'
	| 'ASKING_DISABLED'
	| 'DECLARING_DISABLED'
	| 'UNKNOWN_CARD'
	| 'UNKNOWN_SET'
	| 'SET_ALREADY_RESOLVED'
	| 'NOT_HOLDING_SET'
	| 'ALREADY_HOLD_CARD'
	| 'TARGET_IS_TEAMMATE'
	| 'TARGET_HAS_NO_CARDS'
	| 'SEAT_NOT_AT_TABLE'
	| 'ANTI_DECLARE_DISABLED'
	| 'BAD_ASSIGNMENT'
	| 'NOT_THE_DECLARER'
	| 'NOT_AWAITING_HANDOFF'
	| 'BAD_HANDOFF_TARGET'
	| 'NOT_CHOOSING_DECLARER'
	| 'BAD_DECLARER_CHOICE';

const DECK_SET = new Set(makeDeck());
const HALF_SUIT_SET = new Set<string>(HALF_SUITS);

export function isCard(card: string): boolean {
	return DECK_SET.has(card);
}

export function isHalfSuit(set: string): set is HalfSuitId {
	return HALF_SUIT_SET.has(set);
}

/* ---------------------------------------------------------------- queries */

export function holderOf(state: GameState, card: CardId): SeatId {
	for (let seat = 0; seat < state.size; seat++) {
		if (state.hands[seat].includes(card)) return seat;
	}
	return -1;
}

export function seatsOnTeam(size: TableSize, team: Team): SeatId[] {
	const seats: SeatId[] = [];
	for (let seat = 0; seat < size; seat++) if (teamOf(seat) === team) seats.push(seat);
	return seats;
}

export function scores(state: GameState): [number, number] {
	const out: [number, number] = [0, 0];
	for (const set of HALF_SUITS) {
		const resolved = state.resolved[set];
		if (resolved) out[resolved.team]++;
	}
	return out;
}

export function unresolvedSets(state: GameState): HalfSuitId[] {
	return HALF_SUITS.filter((set) => !state.resolved[set]);
}

/** Only meaningful once the game is over. Nine sets means this is never a draw. */
export function winner(state: GameState): Team | null {
	if (state.phase.kind !== 'over') return null;
	const [a, b] = scores(state);
	return a > b ? 0 : 1;
}

/**
 * Every card this seat could legally name: one they do not hold, in an unresolved set they
 * hold at least one card of.
 */
export function askableCards(state: GameState, seat: SeatId): CardId[] {
	const hand = state.hands[seat];
	const held = new Set(hand);
	const sets = new Set(hand.map(halfSuitOf));
	const out: CardId[] = [];
	for (const set of sets) {
		if (state.resolved[set]) continue;
		for (const card of cardsInHalfSuit(set)) if (!held.has(card)) out.push(card);
	}
	return out;
}

/** Opponents who still hold at least one card. */
export function askableTargets(state: GameState, seat: SeatId): SeatId[] {
	const out: SeatId[] = [];
	for (let other = 0; other < state.size; other++) {
		if (teamOf(other) === teamOf(seat)) continue;
		if (state.hands[other].length === 0) continue;
		out.push(other);
	}
	return out;
}

/**
 * False when a player holds cards but cannot ask — every set they hold is complete in their
 * own hand. Reachable in the four-player game, where hands are 13–14 cards. They must
 * declare instead, which is always available to them since they hold all six.
 */
export function hasLegalAsk(state: GameState, seat: SeatId): boolean {
	return askableCards(state, seat).length > 0 && askableTargets(state, seat).length > 0;
}

/** Seats a declaration in this mode is allowed to name. */
export function assignableSeats(state: GameState, declarer: SeatId, mode: DeclareMode): SeatId[] {
	const team = mode === 'ours' ? teamOf(declarer) : otherTeam(teamOf(declarer));
	return seatsOnTeam(state.size, team);
}

/* ---------------------------------------------------------------- setup */

export function createGame(size: TableSize, options: GameOptions, rng: Rng): GameState {
	return settle({
		size,
		options,
		hands: deal(size, rng),
		resolved: {},
		/* Seat 0 deals, and the dealer takes the first turn. */
		turn: 0,
		phase: { kind: 'playing' },
		lastMove: null,
		move: 0
	});
}

function clone(state: GameState): GameState {
	return { ...state, hands: state.hands.map((hand) => [...hand]), resolved: { ...state.resolved } };
}

/**
 * Recomputes the phase after every move. All three of "the game ended", "one team ran out"
 * and "the turn landed on an empty hand" are consequences of the same board, so deriving
 * them in one place is what keeps the individual move handlers simple.
 */
function settle(state: GameState): GameState {
	if (unresolvedSets(state).length === 0) {
		state.phase = { kind: 'over' };
		return state;
	}

	const teamHasCards: [boolean, boolean] = [false, false];
	for (let seat = 0; seat < state.size; seat++) {
		if (state.hands[seat].length > 0) teamHasCards[teamOf(seat)] = true;
	}

	/* One team is out: asking stops for good and the other team declares the remainder. */
	if (!teamHasCards[0] || !teamHasCards[1]) {
		const live: Team = teamHasCards[0] ? 0 : 1;

		/* A run already under way continues with the same declarer while they hold cards. */
		if (state.phase.kind === 'final_declarations' && state.hands[state.phase.declarer].length > 0) {
			state.turn = state.phase.declarer;
			return state;
		}

		state.phase =
			teamOf(state.turn) === live && state.hands[state.turn].length > 0
				? { kind: 'final_declarations', declarer: state.turn }
				: { kind: 'choosing_final_declarer', chooser: state.turn };
		return state;
	}

	/* A player with no cards cannot be asked, so the turn cannot rest with them. */
	if (state.hands[state.turn].length === 0) {
		state.phase = { kind: 'awaiting_handoff', seat: state.turn };
		return state;
	}

	state.phase = { kind: 'playing' };
	return state;
}

function fail(code: RuleError): never {
	throw new Error(code);
}

/* ---------------------------------------------------------------- asking */

export function canAsk(
	state: GameState,
	asker: SeatId,
	target: SeatId,
	card: CardId
): RuleError | null {
	if (state.phase.kind === 'over') return 'GAME_OVER';
	if (state.phase.kind !== 'playing') return 'ASKING_DISABLED';
	if (state.turn !== asker) return 'NOT_YOUR_TURN';
	if (!Number.isInteger(target) || target < 0 || target >= state.size) return 'SEAT_NOT_AT_TABLE';
	if (teamOf(target) === teamOf(asker)) return 'TARGET_IS_TEAMMATE';
	if (state.hands[target].length === 0) return 'TARGET_HAS_NO_CARDS';
	if (!isCard(card)) return 'UNKNOWN_CARD';

	const set = halfSuitOf(card);
	if (state.resolved[set]) return 'SET_ALREADY_RESOLVED';

	const hand = state.hands[asker];
	if (hand.includes(card)) return 'ALREADY_HOLD_CARD';
	if (!hand.some((held) => halfSuitOf(held) === set)) return 'NOT_HOLDING_SET';

	return null;
}

export function applyAsk(state: GameState, asker: SeatId, target: SeatId, card: CardId): GameState {
	const error = canAsk(state, asker, target, card);
	if (error) fail(error);

	const next = clone(state);
	const targetHand = next.hands[target];
	const at = targetHand.indexOf(card);
	const hit = at >= 0;

	if (hit) {
		/* A hit keeps the turn — the asker must ask again. */
		targetHand.splice(at, 1);
		next.hands[asker].push(card);
	} else {
		next.turn = target;
	}

	next.lastMove = { kind: 'ask', asker, target, card, hit };
	next.move++;
	return settle(next);
}

/* ---------------------------------------------------------------- declaring */

export function canDeclare(
	state: GameState,
	declarer: SeatId,
	set: string,
	mode: DeclareMode,
	assign: Assignment
): RuleError | null {
	if (state.phase.kind === 'over') return 'GAME_OVER';
	if (!Number.isInteger(declarer) || declarer < 0 || declarer >= state.size)
		return 'SEAT_NOT_AT_TABLE';

	/* While the table is waiting on someone to nominate a final declarer, nobody declares. */
	if (state.phase.kind === 'choosing_final_declarer') return 'DECLARING_DISABLED';
	/* The endgame run belongs to one player, and the other team holds nothing to call. */
	if (state.phase.kind === 'final_declarations') {
		if (state.phase.declarer !== declarer) return 'NOT_THE_DECLARER';
		if (mode !== 'ours') return 'BAD_ASSIGNMENT';
	}

	if (!isHalfSuit(set)) return 'UNKNOWN_SET';
	if (state.resolved[set]) return 'SET_ALREADY_RESOLVED';
	if (mode !== 'ours' && mode !== 'theirs') return 'BAD_ASSIGNMENT';
	if (mode === 'theirs' && !state.options.antiDeclare) return 'ANTI_DECLARE_DISABLED';

	/* Exactly the six cards of the set, each on the team the mode asserts. */
	const cards = cardsInHalfSuit(set);
	if (Object.keys(assign).length !== CARDS_PER_HALF_SUIT) return 'BAD_ASSIGNMENT';
	const wanted = mode === 'ours' ? teamOf(declarer) : otherTeam(teamOf(declarer));
	for (const card of cards) {
		const seat = assign[card];
		if (!Number.isInteger(seat) || seat < 0 || seat >= state.size) return 'BAD_ASSIGNMENT';
		if (teamOf(seat) !== wanted) return 'BAD_ASSIGNMENT';
	}

	return null;
}

export function applyDeclare(
	state: GameState,
	declarer: SeatId,
	set: HalfSuitId,
	mode: DeclareMode,
	assign: Assignment
): GameState {
	const error = canDeclare(state, declarer, set, mode, assign);
	if (error) fail(error);

	const cards = cardsInHalfSuit(set);
	const truth: Assignment = {};
	for (const card of cards) truth[card] = holderOf(state, card);

	/* Naming the wrong holder and naming a card an opponent holds are the same failure: the
	   assignment is constrained to one team, so an opponent's card can never match. */
	const success = cards.every((card) => truth[card] === assign[card]);
	const scoringTeam = success ? teamOf(declarer) : otherTeam(teamOf(declarer));

	const next = clone(state);
	const gone = new Set(cards);
	next.hands = next.hands.map((hand) => hand.filter((card) => !gone.has(card)));
	next.resolved = {
		...next.resolved,
		[set]: { team: scoringTeam, declarer, mode, success, truth }
	};
	next.lastMove = { kind: 'declare', declarer, set, mode, assign, truth, success, scoringTeam };
	next.move++;
	return settle(next);
}

/* ---------------------------------------------------------------- turn handoff */

export function canHandoff(state: GameState, from: SeatId, to: SeatId): RuleError | null {
	if (state.phase.kind !== 'awaiting_handoff') return 'NOT_AWAITING_HANDOFF';
	if (state.phase.seat !== from) return 'NOT_YOUR_TURN';
	if (!Number.isInteger(to) || to < 0 || to >= state.size) return 'SEAT_NOT_AT_TABLE';
	if (to === from || teamOf(to) !== teamOf(from)) return 'BAD_HANDOFF_TARGET';
	if (state.hands[to].length === 0) return 'BAD_HANDOFF_TARGET';
	return null;
}

export function applyHandoff(state: GameState, from: SeatId, to: SeatId): GameState {
	const error = canHandoff(state, from, to);
	if (error) fail(error);

	const next = clone(state);
	next.turn = to;
	next.lastMove = { kind: 'handoff', from, to };
	next.move++;
	return settle(next);
}

/** Teammates who could take the turn from an empty-handed player. */
export function handoffTargets(state: GameState, from: SeatId): SeatId[] {
	return seatsOnTeam(state.size, teamOf(from)).filter(
		(seat) => seat !== from && state.hands[seat].length > 0
	);
}

/* ---------------------------------------------------------------- final declarer */

export function canChooseFinalDeclarer(
	state: GameState,
	chooser: SeatId,
	seat: SeatId
): RuleError | null {
	if (state.phase.kind !== 'choosing_final_declarer') return 'NOT_CHOOSING_DECLARER';
	if (state.phase.chooser !== chooser) return 'NOT_YOUR_TURN';
	if (!Number.isInteger(seat) || seat < 0 || seat >= state.size) return 'SEAT_NOT_AT_TABLE';
	/* Only the surviving team holds anything, so "has cards" already pins the team. */
	if (state.hands[seat].length === 0) return 'BAD_DECLARER_CHOICE';
	return null;
}

export function applyChooseFinalDeclarer(
	state: GameState,
	chooser: SeatId,
	seat: SeatId
): GameState {
	const error = canChooseFinalDeclarer(state, chooser, seat);
	if (error) fail(error);

	const next = clone(state);
	next.turn = seat;
	next.phase = { kind: 'final_declarations', declarer: seat };
	next.move++;
	return settle(next);
}

/** Candidates to make the closing declarations: whoever still holds cards. */
export function finalDeclarerChoices(state: GameState): SeatId[] {
	const out: SeatId[] = [];
	for (let seat = 0; seat < state.size; seat++) {
		if (state.hands[seat].length > 0) out.push(seat);
	}
	return out;
}
