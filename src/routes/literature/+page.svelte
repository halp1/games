<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { Button } from '$lib/components';
	import { setConnection } from '$lib/connection.svelte';
	import type { TableSize } from '$lib/literature/cards';
	import { Table, storedName } from '$lib/literature/client.svelte';
	import { network, watchNetwork } from '$lib/literature/feel.svelte';
	import type { ClientMsg } from '$lib/literature/protocol';
	import Game from './Game.svelte';
	import Landing from './Landing.svelte';
	import Lobby from './Lobby.svelte';

	/* One prerendered route for the whole game. A dynamic [code] segment cannot be
	   prerendered without an entries list, and giving up prerendering would cost the offline
	   shell — so the room lives in a query parameter instead. Share links still work.
	   Guarded by `browser` because reading searchParams while prerendering is an error: the
	   generated HTML is shared by every query string, so it cannot depend on one. */
	const codeFromUrl = $derived(
		browser ? (page.url.searchParams.get('r')?.toUpperCase() ?? '') : ''
	);

	const table = new Table();
	let name = $state(storedName());

	watchNetwork();

	/* Publishes to the shell's header indicator. Offline outranks the socket's own view of
	   things: a dropped radio reads as "reconnecting" forever otherwise, which tells nobody
	   the actual problem. */
	$effect(() => {
		if (table.status === 'idle') return setConnection(null);
		setConnection(!network.online ? 'offline' : table.status);
	});

	onDestroy(() => setConnection(null));

	onDestroy(() => table.stop());

	const send = (msg: ClientMsg) => table.send(msg);

	function create(chosen: string, size: TableSize, antiDeclare: boolean) {
		table.create(chosen, size, antiDeclare);
	}

	function join(code: string, chosen: string) {
		table.join(code, chosen);
		/* Reflect the room in the URL so a refresh rejoins and the link is shareable. */
		if (code !== codeFromUrl) history.replaceState(null, '', `?r=${code}`);
	}

	function startOver() {
		table.stop();
		table.view = null;
		table.lost = false;
		history.replaceState(null, '', '/literature');
	}
</script>

<svelte:head>
	<title>Literature · halp/games</title>
	<meta
		name="description"
		content="Literature (Fish) — the team card game of memory and deduction."
	/>
</svelte:head>

{#if table.lost}
	<div class="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10 text-center">
		<p class="text-sm tracking-widest text-border uppercase">Room unavailable</p>
		<p class="max-w-sm text-sm text-muted">
			{table.error ?? 'That room is no longer available.'}
			<!-- Rooms live in memory, so a deploy ends them. Saying so beats a silent retry loop. -->
			Games do not survive a server restart.
		</p>
		<Button onclick={startOver}>Start a new game</Button>
	</div>
{:else if !table.view}
	<Landing code={codeFromUrl} bind:name onCreate={create} onJoin={join} />

	{#if !network.online}
		<p class="pb-8 text-center text-sm tracking-widest text-danger uppercase">
			Offline — Literature needs a connection
		</p>
	{:else if table.status === 'connecting' || table.status === 'reconnecting'}
		<p class="pb-8 text-center text-sm tracking-widest text-border uppercase">Connecting…</p>
	{/if}
	{#if table.error}
		<p class="px-4 pb-8 text-center text-sm text-[#ff8080]">{table.error}</p>
	{/if}
{:else if table.view.stage === 'lobby'}
	<Lobby view={table.view} busy={table.busy} {send} />
{:else}
	<Game view={table.view} busy={table.busy} status={table.status} error={table.error} {send} />
{/if}
