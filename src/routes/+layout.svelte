<script lang="ts">
	import './layout.css';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { ArrowLeft } from '@lucide/svelte';
	import {
		CONNECTION_LABEL,
		CONNECTION_TEXT,
		CONNECTION_TONE,
		connection
	} from '$lib/connection.svelte';

	let { children } = $props();

	/* One back link in the shell covers every game, current and future. */
	const isGame = $derived(page.url.pathname !== resolve('/'));
</script>

<svelte:head><link rel="icon" href="/favicon.ico" /></svelte:head>

<div class="relative flex min-h-dvh flex-col overflow-x-hidden">
	<header
		class="sticky top-0 z-10 flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-4 sm:px-3"
	>
		{#if isGame}
			<a
				href={resolve('/')}
				aria-label="Back to all games"
				class="-ml-2 flex h-full w-8 shrink-0 items-center justify-center text-muted no-underline transition-colors hover:text-accent"
			>
				<ArrowLeft size={16} />
			</a>
		{/if}
		<a
			href={resolve('/')}
			class="flex h-full shrink-0 items-center font-heading text-base tracking-[0.08em] text-accent uppercase no-underline sm:text-lg"
		>
			HALP/GAMES
		</a>

		<!-- Only games holding a live connection set this; everything else leaves the header
		     exactly as it was. A bare logo leaves plenty of room, so the label shows at every
		     width — a lone dot makes people guess. -->
		{#if connection.status}
			{@const status = connection.status}
			<span
				class="ml-auto flex shrink-0 items-center gap-1.5"
				role="status"
				aria-label="Connection: {CONNECTION_LABEL[status]}"
			>
				<span
					class="h-1.5 w-1.5 shrink-0 {CONNECTION_TONE[status]} {status === 'open' ? '' : 'pulse'}"
				></span>
				<span class="text-[0.65rem] tracking-[0.12em] uppercase {CONNECTION_TEXT[status]}">
					{CONNECTION_LABEL[status]}
				</span>
			</span>
		{/if}
	</header>
	<main class="relative z-1 flex flex-1 flex-col">
		{@render children()}
	</main>
</div>
