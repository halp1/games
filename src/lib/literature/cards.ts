/**
 * The 54-card deck and its nine half-suits.
 *
 * Card ids are always exactly two characters — rank then suit ("2S", "TH", "AD"), with the
 * two jokers as "XR" and "XB". Fixed width means parsing never needs a delimiter, and "T"
 * rather than "10" is what keeps it fixed. Display turns T back into 10.
 */

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export type Rank = (typeof RANKS)[number];

/** A two-character card id. */
export type CardId = string;

export const RED_JOKER: CardId = 'XR';
export const BLACK_JOKER: CardId = 'XB';

/** The six ranks of a low (minor) half-suit. */
export const LOW_RANKS = ['2', '3', '4', '5', '6', '7'] as const;
/** The six ranks of a high (major) half-suit. */
export const HIGH_RANKS = ['9', 'T', 'J', 'Q', 'K', 'A'] as const;

/**
 * The nine scoring units. Eight are half a suit; the ninth is the four 8s plus both jokers,
 * which is what a full 54-card deck buys over the more common 48-card game — nine sets means
 * a majority is five and a draw is impossible.
 */
export const HALF_SUITS = ['SL', 'SH', 'HL', 'HH', 'DL', 'DH', 'CL', 'CH', 'EIGHTS'] as const;
export type HalfSuitId = (typeof HALF_SUITS)[number];

export const CARDS_PER_HALF_SUIT = 6;
export const DECK_SIZE = 54;

const EIGHTS_CARDS: CardId[] = ['8S', '8H', '8D', '8C', RED_JOKER, BLACK_JOKER];

export const TABLE_SIZES = [4, 6, 8] as const;
export type TableSize = (typeof TABLE_SIZES)[number];

export function isTableSize(n: number): n is TableSize {
	return (TABLE_SIZES as readonly number[]).includes(n);
}

export function isJoker(card: CardId): boolean {
	return card === RED_JOKER || card === BLACK_JOKER;
}

export function rankOf(card: CardId): Rank | null {
	return isJoker(card) ? null : (card[0] as Rank);
}

export function suitOf(card: CardId): Suit | null {
	return isJoker(card) ? null : (card[1] as Suit);
}

/** Every card belongs to exactly one half-suit. */
export function halfSuitOf(card: CardId): HalfSuitId {
	if (isJoker(card)) return 'EIGHTS';
	const rank = card[0] as Rank;
	if (rank === '8') return 'EIGHTS';
	const half = (LOW_RANKS as readonly string[]).includes(rank) ? 'L' : 'H';
	return (card[1] + half) as HalfSuitId;
}

/** The six cards of a half-suit, in display order. */
export function cardsInHalfSuit(id: HalfSuitId): CardId[] {
	if (id === 'EIGHTS') return [...EIGHTS_CARDS];
	const suit = id[0];
	const ranks = id[1] === 'L' ? LOW_RANKS : HIGH_RANKS;
	return ranks.map((r) => r + suit);
}

export function makeDeck(): CardId[] {
	const deck: CardId[] = [];
	for (const suit of SUITS) for (const rank of RANKS) deck.push(rank + suit);
	deck.push(RED_JOKER, BLACK_JOKER);
	return deck;
}

/* ---------------------------------------------------------------- display */

export const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** Hearts, diamonds and the red joker paint with `--color-suit-red`. */
export function isRedCard(card: CardId): boolean {
	if (card === RED_JOKER) return true;
	if (card === BLACK_JOKER) return false;
	const suit = card[1];
	return suit === 'H' || suit === 'D';
}

/** "T" is only a storage convention — players read 10. */
export function rankLabel(card: CardId): string {
	if (isJoker(card)) return 'JKR';
	const rank = card[0];
	return rank === 'T' ? '10' : rank;
}

export function suitLabel(card: CardId): string {
	const suit = suitOf(card);
	return suit ? SUIT_GLYPH[suit] : '';
}

/** e.g. "10♥", "A♠", "JKR". */
export function cardLabel(card: CardId): string {
	return rankLabel(card) + suitLabel(card);
}

export function halfSuitLabel(id: HalfSuitId): string {
	if (id === 'EIGHTS') return '8s';
	return `${SUIT_GLYPH[id[0] as Suit]} ${id[1] === 'L' ? 'LOW' : 'HIGH'}`;
}

/** Compact form for the resolved-set strip, where space is tightest. */
export function halfSuitShortLabel(id: HalfSuitId): string {
	if (id === 'EIGHTS') return '8s';
	return `${SUIT_GLYPH[id[0] as Suit]}${id[1]}`;
}

/**
 * Groups a hand by half-suit and orders each group by rank. Deterministic, so a card never
 * jumps position when an unrelated one arrives or leaves — which matters a lot when players
 * are tapping quickly.
 */
export function sortHand(hand: readonly CardId[]): CardId[] {
	const setRank = new Map(HALF_SUITS.map((id, i) => [id as string, i]));
	const cardRank = new Map<CardId, number>();
	for (const id of HALF_SUITS) {
		cardsInHalfSuit(id).forEach((card, i) => cardRank.set(card, i));
	}
	return [...hand].sort((a, b) => {
		const bySet = setRank.get(halfSuitOf(a))! - setRank.get(halfSuitOf(b))!;
		return bySet !== 0 ? bySet : cardRank.get(a)! - cardRank.get(b)!;
	});
}

/* ---------------------------------------------------------------- dealing */

export type Rng = () => number;

/** Seedable PRNG, so a deal can be reproduced exactly in a test. */
export function mulberry32(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/**
 * How many cards each seat receives. 54 divides evenly only among six players; at four and
 * eight the remainder goes one card at a time down the seating order.
 *
 * That stays fair because the remainder (`54 % size`) is even at every supported size — 2, 0
 * and 6 — and seats alternate teams, so the extras always split evenly and each team holds
 * exactly 27 cards. `dealIsBalanced` asserts it rather than trusting the comment.
 */
export function handSizes(size: TableSize): number[] {
	const base = Math.floor(DECK_SIZE / size);
	const extra = DECK_SIZE % size;
	return Array.from({ length: size }, (_, seat) => base + (seat < extra ? 1 : 0));
}

/** True when both teams receive the same number of cards. Holds for 4, 6 and 8. */
export function dealIsBalanced(size: TableSize): boolean {
	const sizes = handSizes(size);
	const total = (team: number) =>
		sizes.reduce((sum, n, seat) => sum + (seat % 2 === team ? n : 0), 0);
	return total(0) === total(1);
}

export function deal(size: TableSize, rng: Rng): CardId[][] {
	const deck = shuffle(makeDeck(), rng);
	const hands: CardId[][] = [];
	let at = 0;
	for (const n of handSizes(size)) {
		hands.push(deck.slice(at, at + n));
		at += n;
	}
	return hands;
}
