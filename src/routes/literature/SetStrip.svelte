<script lang="ts">
	import { HALF_SUITS, halfSuitShortLabel, type HalfSuitId } from '$lib/literature/cards';
	import type { PlayerView } from '$lib/literature/view';

	interface Props {
		game: PlayerView;
		onpick?: (set: HalfSuitId) => void;
	}

	let { game, onpick }: Props = $props();

	/* The one thing that is permanently visible. Everything else about the past is gone by
	   design — this game is played from memory — but who owns which set is public forever. */
	const won = $derived(new Map(game.resolved.map((entry) => [entry.set, entry.team])));
</script>

<!-- Nine tiles across a phone would be ~34px each, which is unreadable; 5+4 over two rows
     gives ~62px. A single row only from sm: up. -->
<div class="grid shrink-0 grid-cols-5 gap-1 border-b border-border bg-surface p-2 sm:grid-cols-9">
	{#each HALF_SUITS as set (set)}
		{@const team = won.get(set)}
		{@const ours = team === game.yourTeam}
		{@const open = onpick !== undefined && team === undefined}
		<button
			type="button"
			disabled={!open}
			onclick={open ? () => onpick?.(set) : undefined}
			title={halfSuitShortLabel(set)}
			class="flex h-8 items-center justify-center border text-xs select-none {team === undefined
				? 'border-border text-muted'
				: ours
					? 'border-accent bg-accent/10 text-accent'
					: 'border-rival bg-rival/10 text-rival'} {open
				? 'cursor-pointer hover:border-accent hover:text-accent'
				: 'cursor-default'}"
		>
			{halfSuitShortLabel(set)}
		</button>
	{/each}
</div>
