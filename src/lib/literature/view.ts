/**
 * The redaction boundary.
 *
 * `toPlayerView` is the ONLY path from authoritative room state to anything outside the
 * server — the wire, and the bots. Nothing else may serialise a `GameState`. If a card a
 * player should not know about ever reaches a client, it came through here.
 *
 * Bots consume this same function, which is what makes their fairness structural rather than
 * a promise: a bot cannot see more than a human in its seat, because there is no other way
 * for it to see anything at all.
 */
import { sortHand, type CardId, type HalfSuitId, type TableSize } from './cards';
import {
	askableCards,
	askableTargets,
	finalDeclarerChoices,
	handoffTargets,
	hasLegalAsk,
	scores,
	teamOf,
	unresolvedSets,
	winner,
	type Assignment,
	type DeclareMode,
	type GameOptions,
	type GameState,
	type LastMove,
	type Phase,
	type SeatId,
	type Team
} from './rules';

/** Room-level facts the rules engine has no opinion about. */
export interface TableMeta {
	names: string[];
	bots: boolean[];
	connected: boolean[];
	host: SeatId;
}

export interface SeatView {
	seat: SeatId;
	name: string;
	team: Team;
	isBot: boolean;
	connected: boolean;
	/** Public information — everyone can see how many cards everyone holds. */
	cards: number;
	isYou: boolean;
	isTeammate: boolean;
}

export interface ResolvedView {
	set: HalfSuitId;
	team: Team;
	declarer: SeatId;
	mode: DeclareMode;
	success: boolean;
	/** Revealed when the set resolved, and visible from then on. */
	truth: Assignment;
}

export interface PlayerView {
	move: number;
	size: TableSize;
	you: SeatId;
	yourTeam: Team;
	hand: CardId[];
	seats: SeatView[];
	turn: SeatId;
	phase: Phase;
	/** The single most recent move. Never a history — this game is played from memory. */
	lastMove: LastMove | null;
	resolved: ResolvedView[];
	unresolved: HalfSuitId[];
	options: GameOptions;
	scores: [number, number];
	winner: Team | null;
	/* Affordances, derived from this seat's own hand plus public information. Sent so that
	   client, server and bot cannot disagree about what is legal. */
	yourTurn: boolean;
	canAsk: boolean;
	canDeclare: boolean;
	askableCards: CardId[];
	askableTargets: SeatId[];
	handoffTargets: SeatId[];
	finalDeclarerChoices: SeatId[];
}

export function toPlayerView(state: GameState, seat: SeatId, meta: TableMeta): PlayerView {
	const yourTeam = teamOf(seat);
	const phase = state.phase;

	const seats: SeatView[] = [];
	for (let other = 0; other < state.size; other++) {
		seats.push({
			seat: other,
			name: meta.names[other] ?? `Seat ${other + 1}`,
			team: teamOf(other),
			isBot: meta.bots[other] ?? false,
			connected: meta.connected[other] ?? false,
			/* A count, never the cards. */
			cards: state.hands[other].length,
			isYou: other === seat,
			isTeammate: other !== seat && teamOf(other) === yourTeam
		});
	}

	const resolved: ResolvedView[] = [];
	for (const [set, entry] of Object.entries(state.resolved)) {
		if (entry) resolved.push({ set: set as HalfSuitId, ...entry });
	}

	const yourTurn = state.turn === seat;
	const asking = phase.kind === 'playing' && yourTurn && hasLegalAsk(state, seat);

	/* Declaring is any-time, so it is gated on the phase rather than on whose turn it is. */
	const declaring =
		phase.kind === 'playing' ||
		phase.kind === 'awaiting_handoff' ||
		(phase.kind === 'final_declarations' && phase.declarer === seat);

	return {
		move: state.move,
		size: state.size,
		you: seat,
		yourTeam,
		hand: sortHand(state.hands[seat]),
		seats,
		turn: state.turn,
		phase,
		lastMove: state.lastMove,
		resolved,
		unresolved: unresolvedSets(state),
		options: state.options,
		scores: scores(state),
		winner: winner(state),
		yourTurn,
		canAsk: asking,
		canDeclare: declaring && unresolvedSets(state).length > 0,
		askableCards: asking ? askableCards(state, seat) : [],
		askableTargets: asking ? askableTargets(state, seat) : [],
		handoffTargets:
			phase.kind === 'awaiting_handoff' && phase.seat === seat ? handoffTargets(state, seat) : [],
		finalDeclarerChoices:
			phase.kind === 'choosing_final_declarer' && phase.chooser === seat
				? finalDeclarerChoices(state)
				: []
	};
}

/**
 * Every card id reachable in a serialised view. Used by the redaction test; kept here so it
 * sits next to the thing it guards.
 */
export function cardsReachableIn(view: PlayerView): Set<CardId> {
	const found = new Set<CardId>();
	const walk = (node: unknown): void => {
		if (typeof node === 'string') {
			found.add(node);
		} else if (Array.isArray(node)) {
			node.forEach(walk);
		} else if (node && typeof node === 'object') {
			for (const [key, value] of Object.entries(node)) {
				/* Assignment maps carry card ids as *keys*. */
				found.add(key);
				walk(value);
			}
		}
	};
	walk(view);
	return found;
}
