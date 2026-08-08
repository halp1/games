<script lang="ts">
	import { Button } from '$lib/components';
	import {
		cardLabel,
		cardsInHalfSuit,
		halfSuitLabel,
		halfSuitOf,
		type CardId,
		type HalfSuitId
	} from '$lib/literature/cards';
	import type { Status } from '$lib/literature/client.svelte';
	import { BUZZ, buzz, keepAwake, network } from '$lib/literature/feel.svelte';
	import type { ClientMsg, RoomView } from '$lib/literature/protocol';
	import type { Assignment, DeclareMode, SeatId } from '$lib/literature/rules';
	import DeclareSheet from './DeclareSheet.svelte';
	import PlayingCard from './PlayingCard.svelte';
	import Seats from './Seats.svelte';
	import SetStrip from './SetStrip.svelte';

	interface Props {
		view: RoomView;
		busy: boolean;
		status: Status;
		error: string | null;
		send: (msg: ClientMsg) => void;
	}

	let { view, busy, status, error, send }: Props = $props();

	const game = $derived(view.game!);

	let wanted = $state<CardId | null>(null);
	let target = $state<SeatId | null>(null);
	let declaring = $state(false);
	let declareSet = $state<HalfSuitId | null>(null);

	/* A snapshot arriving means the position moved on; any half-composed ask is now stale.
	   The same edge is where haptics fire, since it is exactly "something just happened". */
	let lastMoveSeen = $state(-1);
	let wasYourTurn = $state(false);
	$effect(() => {
		if (game.move === lastMoveSeen) return;
		const first = lastMoveSeen === -1;
		lastMoveSeen = game.move;
		wanted = null;
		target = null;

		const move = game.lastMove;
		/* Three moments only. Buzzing on every move would make a six-handed game unbearable. */
		if (!first) {
			if (move?.kind === 'declare') buzz(BUZZ.resolved);
			else if (move?.kind === 'ask' && move.hit && move.target === game.you) buzz(BUZZ.lost);
			else if (game.yourTurn && !wasYourTurn) buzz(BUZZ.turn);
		}
		wasYourTurn = game.yourTurn;
	});

	/* Someone else's long think should not put the screen to sleep mid-hand. */
	keepAwake(() => game.phase.kind !== 'over' && !view.paused);

	const askable = $derived(new Set(game.askableCards));

	/**
	 * Your hand and your options are the same picture: one row per unresolved set you hold a
	 * card of, showing all six slots. Solid tiles are yours, ghosts are what you can ask for.
	 * That is how a Literature player already thinks about their hand.
	 */
	const rows = $derived.by(() => {
		const held = new Set(game.hand);
		const sets: HalfSuitId[] = [];
		for (const card of game.hand) {
			const set = halfSuitOf(card);
			if (!sets.includes(set)) sets.push(set);
		}
		return sets.map((set) => ({
			set,
			cards: cardsInHalfSuit(set).map((card) => ({ card, mine: held.has(card) }))
		}));
	});

	const canAskNow = $derived(game.canAsk && !view.paused);
	const readyToAsk = $derived(canAskNow && wanted !== null && target !== null);

	const handoff = $derived(
		game.phase.kind === 'awaiting_handoff' && game.phase.seat === game.you
			? game.handoffTargets
			: []
	);
	const nominating = $derived(
		game.phase.kind === 'choosing_final_declarer' && game.phase.chooser === game.you
			? game.finalDeclarerChoices
			: []
	);

	/* The one selectable list at any moment, so the seat strip has a single job. */
	const selectableSeats = $derived(
		handoff.length
			? handoff
			: nominating.length
				? nominating
				: canAskNow && wanted
					? game.askableTargets
					: []
	);

	function pickSeat(seat: SeatId) {
		if (handoff.length) return send({ t: 'handoff', to: seat });
		if (nominating.length) return send({ t: 'chooseFinalDeclarer', seat });
		target = seat;
	}

	function ask() {
		if (!readyToAsk || wanted === null || target === null) return;
		send({ t: 'ask', target, card: wanted });
	}

	function declare(set: HalfSuitId, mode: DeclareMode, assign: Assignment) {
		send({ t: 'declare', set, mode, assign });
		declaring = false;
		declareSet = null;
	}

	const turnName = $derived(game.seats[game.turn]?.name ?? '');
	const over = $derived(game.phase.kind === 'over');
</script>

<!-- Fixed to the viewport minus the h-10 shell header. Only the hand scrolls; the page
     itself never does, which is most of what makes this feel like an app and not a document. -->
<div
	class="game-surface mx-auto flex h-[calc(100dvh-2.5rem)] w-full max-w-3xl flex-col overflow-hidden"
>
	<SetStrip
		{game}
		onpick={game.canDeclare
			? (set) => {
					declareSet = set;
					declaring = true;
				}
			: undefined}
	/>

	<Seats {game} selectable={selectableSeats} onpick={pickSeat} />

	<!-- The last move, and only the last move. It is replaced by the next one and never
	     recorded — remembering it is the game. -->
	{#key game.move}
		<div
			class="flex min-h-14 shrink-0 animate-[fadeUp_0.15s_ease_both] items-center border-b border-border px-3 py-2"
		>
			{#if view.paused}
				<p class="text-sm text-danger">Waiting for {view.paused.name} to reconnect…</p>
			{:else if over}
				<p class="text-sm text-accent">
					{game.winner === game.yourTeam ? 'Your team wins' : 'The other team wins'}
					· {game.scores[game.yourTeam]}–{game.scores[game.yourTeam === 0 ? 1 : 0]}
				</p>
			{:else if game.lastMove?.kind === 'ask'}
				{@const move = game.lastMove}
				<p class="text-sm text-muted">
					<span class="text-text">{game.seats[move.asker].name}</span>
					asked
					<span class="text-text">{game.seats[move.target].name}</span>
					for
					<span class="font-mono text-text">{cardLabel(move.card)}</span>
					·
					<span class={move.hit ? 'text-accent' : 'text-danger'}>{move.hit ? 'GOT IT' : 'NO'}</span>
				</p>
			{:else if game.lastMove?.kind === 'declare'}
				{@const move = game.lastMove}
				<p class="text-sm text-muted">
					<span class="text-text">{game.seats[move.declarer].name}</span>
					declared
					<span class="text-text">{halfSuitLabel(move.set)}</span>
					·
					<span class={move.scoringTeam === game.yourTeam ? 'text-accent' : 'text-rival'}>
						{move.success ? 'CORRECT' : 'WRONG'} — {move.scoringTeam === game.yourTeam
							? 'us'
							: 'them'}
					</span>
				</p>
			{:else if game.lastMove?.kind === 'handoff'}
				{@const move = game.lastMove}
				<p class="text-sm text-muted">
					<span class="text-text">{game.seats[move.from].name}</span>
					passed the turn to
					<span class="text-text">{game.seats[move.to].name}</span>
				</p>
			{:else}
				<p class="text-sm tracking-widest text-border uppercase">
					{game.size / 2} v {game.size / 2} · 9 sets · 5 to win
				</p>
			{/if}
		</div>
	{/key}

	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		{#if handoff.length}
			<p
				class="mb-2 border border-accent/20 bg-accent/6 px-3 py-2.5 text-xs tracking-[0.06em] text-accent"
			>
				You are out of cards. Pick a teammate to take the turn.
			</p>
		{:else if nominating.length}
			<p
				class="mb-2 border border-accent/20 bg-accent/6 px-3 py-2.5 text-xs tracking-[0.06em] text-accent"
			>
				Your team is out. Pick who declares the rest.
			</p>
		{:else if game.phase.kind === 'final_declarations' && game.phase.declarer === game.you}
			<p
				class="mb-2 border border-accent/20 bg-accent/6 px-3 py-2.5 text-xs tracking-[0.06em] text-accent"
			>
				The other team is out. Declare every remaining set — no help from your teammates.
			</p>
		{:else if game.yourTurn && !game.canAsk && !over}
			<p
				class="mb-2 border border-accent/20 bg-accent/6 px-3 py-2.5 text-xs tracking-[0.06em] text-accent"
			>
				No legal ask — every set you hold is complete. You have to declare.
			</p>
		{/if}

		{#each rows as row (row.set)}
			<div class="mb-2 flex items-center gap-2">
				<span
					class="w-12 shrink-0 text-[0.65rem] tracking-[0.08em] text-muted uppercase sm:w-16 sm:text-xs"
				>
					{halfSuitLabel(row.set)}
				</span>
				<div class="flex min-w-0 flex-1 gap-1">
					{#each row.cards as slot (slot.card)}
						<PlayingCard
							card={slot.card}
							state={slot.mine
								? 'held'
								: wanted === slot.card
									? 'selected'
									: askable.has(slot.card)
										? 'open'
										: 'gone'}
							label={slot.mine ? cardLabel(slot.card) : `Ask for ${cardLabel(slot.card)}`}
							onclick={!slot.mine && canAskNow && askable.has(slot.card)
								? () => (wanted = wanted === slot.card ? null : slot.card)
								: undefined}
						/>
					{/each}
				</div>
			</div>
		{/each}

		{#if game.hand.length === 0}
			<div
				class="flex h-32 items-center justify-center text-sm tracking-widest text-border uppercase"
			>
				Out of cards
			</div>
		{/if}
	</div>

	<div
		class="shrink-0 border-t border-border bg-surface p-2"
		style="padding-bottom: calc(0.5rem + env(safe-area-inset-bottom))"
	>
		{#if error}
			<p class="mb-2 px-1 text-xs text-[#ff8080]">{error}</p>
		{/if}
		{#if !network.online}
			<p class="mb-2 px-1 text-xs tracking-widest text-danger uppercase">
				Offline — your seat is held
			</p>
		{:else if status !== 'open'}
			<p class="mb-2 px-1 text-xs tracking-widest text-border uppercase">Reconnecting…</p>
		{/if}

		{#if over}
			<div class="flex items-center gap-2">
				<p class="flex-1 px-1 font-mono text-sm text-muted tabular-nums">
					Us {game.scores[game.yourTeam]} · Them {game.scores[game.yourTeam === 0 ? 1 : 0]}
				</p>
				{#if view.isHost}
					<Button onclick={() => send({ t: 'rematch' })}>Play again</Button>
				{/if}
			</div>
		{:else if readyToAsk}
			<div class="flex items-center gap-2">
				<p class="min-w-0 flex-1 truncate px-1 text-sm text-text">
					Ask <span class="text-accent">{game.seats[target!].name}</span>
					for <span class="font-mono">{cardLabel(wanted!)}</span>
				</p>
				<Button onclick={ask} disabled={busy} class="disabled:opacity-30">Ask</Button>
			</div>
		{:else}
			<div class="flex items-center gap-2">
				<p
					class="min-w-0 flex-1 truncate px-1 text-sm {game.yourTurn
						? 'text-accent'
						: 'text-muted'}"
				>
					{#if view.paused}
						Paused
					{:else if handoff.length || nominating.length}
						Pick a player above
					{:else if game.yourTurn && wanted}
						Now pick who to ask
					{:else if game.yourTurn && game.canAsk}
						Your turn — pick a card to ask for
					{:else if game.yourTurn}
						Your turn
					{:else}
						{turnName}'s turn
					{/if}
				</p>
				<Button
					onclick={() => {
						declareSet = null;
						declaring = true;
					}}
					disabled={!game.canDeclare || busy || !!view.paused}
					class="disabled:opacity-30"
				>
					Declare
				</Button>
			</div>
		{/if}
	</div>
</div>

{#if declaring}
	<DeclareSheet
		{game}
		initialSet={declareSet}
		{busy}
		onclose={() => {
			declaring = false;
			declareSet = null;
		}}
		onsubmit={declare}
	/>
{/if}
