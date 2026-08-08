<script lang="ts">
	import { Bot, Check, Crown, Shuffle, X } from '@lucide/svelte';
	import { Button, CopyButton } from '$lib/components';
	import { TABLE_SIZES, handSizes, type TableSize } from '$lib/literature/cards';
	import type { ClientMsg, RoomView } from '$lib/literature/protocol';

	interface Props {
		view: RoomView;
		busy: boolean;
		send: (msg: ClientMsg) => void;
	}

	let { view, busy, send }: Props = $props();

	/* Two taps to swap: pick a seat, pick another. Simpler than drag on a phone, and it works
	   identically with a mouse. */
	let picked = $state<number | null>(null);

	const filled = $derived(view.seats.filter((seat) => seat.filled).length);
	const deal = $derived(handSizes(view.size));
	const dealLabel = $derived(
		new Set(deal).size === 1 ? `${deal[0]} cards each` : `${deal.join(' / ')} cards`
	);
	const shareUrl = $derived(
		typeof location === 'undefined' ? '' : `${location.origin}/literature?r=${view.code}`
	);

	function tapSeat(seat: number) {
		if (!view.isHost) return;
		if (picked === null) {
			picked = seat;
		} else if (picked === seat) {
			picked = null;
		} else {
			send({ t: 'swapSeats', a: picked, b: seat });
			picked = null;
		}
	}
</script>

<div class="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 p-4 sm:gap-8 sm:p-8">
	<div class="flex flex-col items-center gap-2">
		<p class="text-xs tracking-[0.18em] text-muted uppercase">Room code</p>
		<p class="font-heading text-5xl tracking-[0.2em] text-accent">{view.code}</p>
		<CopyButton text={shareUrl} label="Copy invite link" class="mt-1" />
	</div>

	<div class="border border-border bg-surface">
		<div class="flex h-9 items-center justify-between border-b border-border px-3">
			<span class="text-xs tracking-[0.16em] text-muted uppercase">Seats</span>
			<span class="font-mono text-xs text-muted tabular-nums">{filled} / {view.size}</span>
		</div>

		<!-- Seats alternate teams, which is what puts every player between two opponents. The
		     accent/rival split is relative to you, not fixed to a side. -->
		<div class="divide-y divide-border">
			{#each view.seats as seat (seat.seat)}
				{@const yours = seat.team === view.seats[view.you].team}
				<div class="flex items-center pr-1 {picked === seat.seat ? 'bg-accent/6' : ''}">
					<button
						type="button"
						onclick={() => tapSeat(seat.seat)}
						disabled={!view.isHost}
						class="flex min-h-13 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left transition-colors select-none {view.isHost
							? 'cursor-pointer hover:bg-white/3'
							: 'cursor-default'}"
					>
						<span
							class="w-11 shrink-0 text-xs tracking-[0.12em] uppercase {yours
								? 'text-accent'
								: 'text-rival'}"
						>
							{yours ? 'Us' : 'Them'}
						</span>

						{#if seat.filled}
							<span class="flex min-w-0 flex-1 items-center gap-1.5">
								{#if seat.isBot}<Bot size={13} class="shrink-0 text-muted" />{/if}
								<span class="truncate text-sm text-text">{seat.name}</span>
								{#if seat.isHost}<Crown size={12} class="shrink-0 text-accent" />{/if}
								{#if seat.isYou}
									<span class="shrink-0 text-xs tracking-widest text-muted uppercase">you</span>
								{/if}
							</span>
						{:else}
							<span class="flex-1 text-sm tracking-widest text-border uppercase">Open</span>
						{/if}
					</button>

					{#if view.isHost && seat.filled && !seat.isHost}
						<button
							type="button"
							aria-label="Remove {seat.name}"
							onclick={() => send({ t: 'removeSeat', seat: seat.seat })}
							class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center text-muted transition-colors select-none hover:text-danger"
						>
							<X size={14} />
						</button>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	{#if view.isHost}
		<div class="flex flex-col gap-4">
			<div>
				<p class="mb-1 font-mono text-xs tracking-[0.14em] text-muted uppercase">Table size</p>
				<div class="grid grid-cols-3 gap-2">
					{#each TABLE_SIZES as option (option)}
						<button
							type="button"
							onclick={() => send({ t: 'setSize', size: option as TableSize })}
							class="min-h-11 cursor-pointer border bg-bg font-mono text-sm transition-[border-color,color] select-none sm:min-h-10 {view.size ===
							option
								? 'border-accent text-text'
								: 'border-border text-muted hover:border-muted hover:text-text'}"
						>
							{option}
						</button>
					{/each}
				</div>
				<p class="mt-1.5 text-xs text-muted">{dealLabel} · 9 sets · 5 to win</p>
			</div>

			<div class="grid grid-cols-2 gap-2">
				<button
					type="button"
					onclick={() => send({ t: 'addBot' })}
					disabled={filled >= view.size}
					class="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 border border-border bg-transparent px-3 font-mono text-xs tracking-[0.12em] text-muted uppercase transition-all select-none hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted sm:min-h-10"
				>
					<Bot size={13} /> Add bot
				</button>
				<button
					type="button"
					onclick={() => send({ t: 'shuffleSeats' })}
					class="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 border border-border bg-transparent px-3 font-mono text-xs tracking-[0.12em] text-muted uppercase transition-all select-none hover:border-accent hover:text-accent sm:min-h-10"
				>
					<Shuffle size={13} /> Random teams
				</button>
			</div>

			<button
				type="button"
				onclick={() => send({ t: 'setAntiDeclare', on: !view.options.antiDeclare })}
				class="flex min-h-11 cursor-pointer items-start gap-3 border bg-transparent p-3 text-left transition-[border-color] select-none {view
					.options.antiDeclare
					? 'border-accent'
					: 'border-border hover:border-muted'}"
			>
				<span
					class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border {view.options
						.antiDeclare
						? 'border-accent bg-accent text-text-inverted'
						: 'border-border'}"
				>
					{#if view.options.antiDeclare}<Check size={11} />{/if}
				</span>
				<span class="min-w-0">
					<span class="block text-sm text-text">Anti-declare</span>
					<span class="block text-xs text-muted">
						Call a set the other team is holding. Wrong either way and they score it.
					</span>
				</span>
			</button>

			<Button
				onclick={() => send({ t: 'start' })}
				disabled={!view.canStart || busy}
				class="w-full disabled:opacity-30"
			>
				{view.canStart ? 'Start game' : `Waiting for ${view.size - filled} more`}
			</Button>

			{#if view.isHost}
				<p class="text-center text-xs text-muted">Tap two seats to swap them.</p>
			{/if}
		</div>
	{:else}
		<div
			class="flex h-40 flex-col items-center justify-center gap-3 text-sm tracking-widest text-border uppercase"
		>
			Waiting for the host
		</div>
	{/if}
</div>
