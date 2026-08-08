<script lang="ts">
	import { Bot, WifiOff } from '@lucide/svelte';
	import NumberFlow from '@number-flow/svelte';
	import type { SeatId } from '$lib/literature/rules';
	import type { PlayerView } from '$lib/literature/view';

	interface Props {
		game: PlayerView;
		/** Seats that can be tapped right now — targets for an ask, a handoff, a nomination. */
		selectable?: SeatId[];
		onpick?: (seat: SeatId) => void;
	}

	let { game, selectable = [], onpick }: Props = $props();

	/* Everyone but you, starting from your left, so the on-screen order matches the table. */
	const others = $derived(
		Array.from({ length: game.size - 1 }, (_, i) => game.seats[(game.you + 1 + i) % game.size])
	);
</script>

<div class="flex shrink-0 gap-1 border-b border-border px-2 py-2">
	{#each others as seat (seat.seat)}
		{@const active = selectable.includes(seat.seat)}
		{@const turn = game.turn === seat.seat}
		<!-- Always a real button, disabled when it is not a legal target. Keeps the tap target,
		     the focus behaviour and the a11y semantics right without a dynamic element. -->
		<button
			type="button"
			disabled={!active}
			onclick={active && onpick ? () => onpick(seat.seat) : undefined}
			class="flex min-w-0 flex-1 flex-col items-center gap-0.5 border px-1 py-1.5 transition-[border-color,opacity] select-none {turn
				? 'border-accent'
				: 'border-border'} {active
				? 'cursor-pointer bg-accent/6 hover:border-accent'
				: 'cursor-default'} {seat.cards === 0 ? 'opacity-40' : ''}"
		>
			<span class="flex w-full items-center justify-center gap-0.5">
				{#if seat.isBot}<Bot size={9} class="shrink-0 text-muted" />{/if}
				{#if !seat.connected}<WifiOff size={9} class="shrink-0 text-danger" />{/if}
				<span
					class="min-w-0 truncate text-[0.65rem] tracking-[0.06em] uppercase {seat.isTeammate
						? 'text-accent'
						: 'text-rival'}"
				>
					{seat.name}
				</span>
			</span>
			<span class="font-heading text-lg leading-none text-text tabular-nums">
				<NumberFlow value={seat.cards} />
			</span>
		</button>
	{/each}
</div>
