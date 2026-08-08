<script lang="ts">
	import { isRedCard, rankLabel, suitLabel, type CardId } from '$lib/literature/cards';

	interface Props {
		card: CardId;
		/**
		 * `held` — in your hand. `open` — still out there, and legal for you to ask for.
		 * `selected` — the ask you are composing. `gone` — accounted for, shown for shape only.
		 */
		state?: 'held' | 'open' | 'selected' | 'gone';
		onclick?: () => void;
		label?: string;
	}

	let { card, state = 'held', onclick, label }: Props = $props();

	const red = $derived(isRedCard(card));
	const joker = $derived(rankLabel(card) === 'JKR');

	/* Sharp corners throughout — the design language has no border radius, so these read as
	   rectangles rather than playing cards, which is intended. */
	const skin = $derived(
		{
			held: 'border-border bg-surface',
			open: 'border-dashed border-border bg-transparent opacity-55',
			selected: 'border-accent bg-surface',
			gone: 'border-border/50 bg-transparent opacity-25'
		}[state]
	);

	const shape =
		'flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 border py-1.5 transition-[border-color,opacity] select-none';
	const tone = $derived(red ? 'text-suit-red' : 'text-text');
</script>

{#snippet face()}
	<span class="font-heading leading-none {joker ? 'text-[0.6rem]' : 'text-base'} {tone}">
		{rankLabel(card)}
	</span>
	{#if !joker}
		<span class="text-xs leading-none {tone}">{suitLabel(card)}</span>
	{/if}
{/snippet}

{#if onclick}
	<button
		type="button"
		aria-label={label}
		{onclick}
		class="{shape} {skin} cursor-pointer hover:border-accent"
	>
		{@render face()}
	</button>
{:else}
	<div class="{shape} {skin}" aria-label={label}>
		{@render face()}
	</div>
{/if}
