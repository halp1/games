<script lang="ts">
	import { untrack } from 'svelte';
	import { ArrowLeft, X } from '@lucide/svelte';
	import { Button } from '$lib/components';
	import {
		CARDS_PER_HALF_SUIT,
		cardLabel,
		cardsInHalfSuit,
		halfSuitLabel,
		type CardId,
		type HalfSuitId
	} from '$lib/literature/cards';
	import type { Assignment, DeclareMode, SeatId } from '$lib/literature/rules';
	import type { PlayerView } from '$lib/literature/view';
	import PlayingCard from './PlayingCard.svelte';

	interface Props {
		game: PlayerView;
		/** Preselected when opened from a tap on the resolved-set strip. */
		initialSet?: HalfSuitId | null;
		busy: boolean;
		onclose: () => void;
		onsubmit: (set: HalfSuitId, mode: DeclareMode, assign: Assignment) => void;
	}

	let { game, initialSet = null, busy, onclose, onsubmit }: Props = $props();

	/* Seeded once, then owned locally — the sheet is remounted each time it opens, so there
	   is nothing to keep in sync. untrack() says that rather than leaving a warning behind. */
	let set = $state<HalfSuitId | null>(untrack(() => initialSet));
	let mode = $state<DeclareMode>('ours');
	let assign = $state<Assignment>({});
	let reviewing = $state(false);

	const held = $derived(new Set(game.hand));

	/* "ours" names your side, "theirs" names the opposition — a declaration is one or the
	   other, never a mix, so the seat list follows straight from the mode. */
	const eligible = $derived(
		game.seats.filter((seat) =>
			mode === 'ours' ? seat.team === game.yourTeam : seat.team !== game.yourTeam
		)
	);

	const cards = $derived(set ? cardsInHalfSuit(set) : []);
	const assignedCount = $derived(cards.filter((card) => assign[card] !== undefined).length);
	const complete = $derived(set !== null && assignedCount === CARDS_PER_HALF_SUIT);

	/** Cards you hold are already known to the server, so lock them in and save the taps. */
	function prefill() {
		if (!set) return;
		const next: Assignment = {};
		if (mode === 'ours') {
			for (const card of cardsInHalfSuit(set)) if (held.has(card)) next[card] = game.you;
		}
		assign = next;
	}

	function choose(card: CardId, seat: SeatId) {
		if (mode === 'ours' && held.has(card)) return;
		assign = { ...assign, [card]: seat };
	}

	function submit() {
		if (!set || !complete) return;
		onsubmit(set, mode, assign);
	}
</script>

<div class="game-surface fixed inset-0 z-50 flex flex-col bg-bg">
	<div class="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 sm:px-3">
		<button
			type="button"
			aria-label={reviewing ? 'Back' : 'Close'}
			onclick={() => (reviewing ? (reviewing = false) : onclose())}
			class="flex h-full w-9 shrink-0 cursor-pointer items-center justify-center text-muted transition-colors select-none hover:text-accent"
		>
			{#if reviewing}<ArrowLeft size={16} />{:else}<X size={16} />{/if}
		</button>
		<span class="flex-1 text-xs tracking-[0.16em] text-text uppercase">
			{reviewing ? 'Confirm declaration' : 'Declare a set'}
		</span>
		{#if set && !reviewing}
			<span class="font-mono text-xs text-muted tabular-nums">
				{assignedCount} / {CARDS_PER_HALF_SUIT}
			</span>
		{/if}
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto p-4">
		{#if !set}
			<p class="mb-3 text-xs tracking-[0.14em] text-muted uppercase">Which set?</p>
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
				{#each game.unresolved as option (option)}
					<button
						type="button"
						onclick={() => {
							set = option;
							prefill();
						}}
						class="min-h-13 cursor-pointer border border-border bg-surface px-3 font-mono text-sm text-text transition-[border-color] select-none hover:border-accent"
					>
						{halfSuitLabel(option)}
					</button>
				{/each}
			</div>
		{:else if reviewing}
			<p class="mb-1 font-heading text-2xl text-text">{halfSuitLabel(set)}</p>
			<p class="mb-4 text-sm text-muted">
				{mode === 'ours'
					? 'You are saying your team holds all six.'
					: 'You are saying the other team holds all six.'}
				Name a single holder wrong and the other team scores it.
			</p>
			<div class="divide-y divide-border border border-border bg-surface">
				{#each cards as card (card)}
					<div class="flex items-center justify-between gap-3 px-3 py-2.5">
						<span class="font-mono text-sm text-text">{cardLabel(card)}</span>
						<span class="truncate text-sm text-accent">
							{game.seats[assign[card]]?.name ?? '—'}
						</span>
					</div>
				{/each}
			</div>
		{:else}
			<div class="mb-4 flex items-center justify-between gap-3">
				<p class="font-heading text-2xl text-text">{halfSuitLabel(set)}</p>
				<button
					type="button"
					onclick={() => {
						set = null;
						assign = {};
					}}
					class="shrink-0 cursor-pointer border-0 border-b border-border bg-transparent p-0 font-mono text-xs tracking-[0.12em] text-muted uppercase transition-colors select-none hover:border-accent hover:text-accent"
				>
					Change
				</button>
			</div>

			{#if game.options.antiDeclare}
				<!-- Hidden entirely when the option is off, so the standard game stays simple. -->
				<div class="mb-4 grid grid-cols-2 gap-2">
					{#each [{ id: 'ours', label: 'We have it' }, { id: 'theirs', label: 'They have it' }] as option (option.id)}
						<button
							type="button"
							onclick={() => {
								mode = option.id as DeclareMode;
								prefill();
							}}
							class="min-h-11 cursor-pointer border bg-transparent px-3 font-mono text-xs tracking-[0.12em] uppercase transition-[border-color,color] select-none {mode ===
							option.id
								? 'border-accent text-accent'
								: 'border-border text-muted hover:border-muted hover:text-text'}"
						>
							{option.label}
						</button>
					{/each}
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				{#each cards as card (card)}
					{@const locked = mode === 'ours' && held.has(card)}
					<div class="flex items-center gap-2 border border-border bg-surface p-2">
						<div class="w-11 shrink-0">
							<PlayingCard {card} state={held.has(card) ? 'held' : 'open'} />
						</div>
						<div class="flex min-w-0 flex-1 flex-wrap gap-1">
							{#if locked}
								<span
									class="flex min-h-11 flex-1 items-center justify-center border border-accent bg-accent/10 px-2 font-mono text-xs tracking-[0.08em] text-accent uppercase sm:min-h-9"
								>
									Yours
								</span>
							{:else}
								{#each eligible as seat (seat.seat)}
									<button
										type="button"
										onclick={() => choose(card, seat.seat)}
										class="min-h-11 min-w-0 flex-1 cursor-pointer truncate border px-2 font-mono text-xs transition-[border-color,color] select-none sm:min-h-9 {assign[
											card
										] === seat.seat
											? 'border-accent text-accent'
											: 'border-border text-muted hover:border-muted hover:text-text'}"
									>
										{seat.isYou ? 'You' : seat.name}
									</button>
								{/each}
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	{#if set}
		<div
			class="shrink-0 border-t border-border bg-surface p-3"
			style="padding-bottom: calc(0.75rem + env(safe-area-inset-bottom))"
		>
			<Button
				onclick={() => (reviewing ? submit() : (reviewing = true))}
				disabled={!complete || busy}
				class="w-full disabled:opacity-30"
			>
				{reviewing
					? 'Confirm declaration'
					: complete
						? 'Review'
						: `Assign all ${CARDS_PER_HALF_SUIT}`}
			</Button>
		</div>
	{/if}
</div>
