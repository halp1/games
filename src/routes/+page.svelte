<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve */
	import { games } from '$lib/games';

	let query = $state('');

	const filtered = $derived(
		games.filter((g) => g.name.toLowerCase().includes(query.toLowerCase()))
	);
</script>

<svelte:head>
	<title>halp/games</title>
</svelte:head>

<div class="p-4 sm:p-8">
	{#if games.length > 0}
		<div class="mb-6 sm:mb-8">
			<input
				type="text"
				placeholder="Search games..."
				bind:value={query}
				class="min-h-11 w-full max-w-sm rounded-none border border-border bg-input-bg px-3 py-2 font-mono text-base text-text outline-none placeholder:text-[#333] focus:border-accent sm:min-h-0 sm:text-sm"
			/>
		</div>
	{/if}

	{#if filtered.length === 0}
		<div
			class="flex h-50 flex-col items-center justify-center gap-3 text-sm tracking-widest text-border uppercase"
		>
			{games.length === 0 ? 'No games yet' : 'No games found'}
		</div>
	{:else}
		<div class="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3 sm:gap-4">
			{#each filtered as game, i (game.slug)}
				<a
					href="/{game.slug}"
					class="card relative block animate-[fadeUp_0.5s_ease_both] border border-border bg-surface px-5 py-6 no-underline transition-[border-color] hover:border-accent sm:px-6 sm:py-7"
					style="animation-delay: {i * 60}ms"
				>
					<p class="mb-2 text-xs tracking-[0.18em] text-accent uppercase">game</p>
					<h2 class="mb-2 font-heading text-2xl text-text">{game.name}</h2>
					<p class="text-sm text-muted">{game.description}</p>
				</a>
			{/each}
		</div>
	{/if}
</div>
