<script lang="ts">
	import { Button, Input, PageHeader } from '$lib/components';
	import { TABLE_SIZES, handSizes, type TableSize } from '$lib/literature/cards';
	import { CODE_LENGTH, MAX_NAME_LENGTH } from '$lib/literature/protocol';

	interface Props {
		/** Prefilled from a share link, so joining is one tap. */
		code?: string;
		name: string;
		onCreate: (name: string, size: TableSize, antiDeclare: boolean) => void;
		onJoin: (code: string, name: string) => void;
	}

	let { code = '', name = $bindable(), onCreate, onJoin }: Props = $props();

	let mode = $state<'join' | 'create'>('create');
	let joinCode = $state('');

	/* The room code arrives after hydration, not during prerender, so the form is seeded once
	   it turns up rather than at construction. A share link means they were invited — put them
	   on the join side with the code already filled in. */
	let seeded = false;
	$effect(() => {
		if (seeded || !code) return;
		seeded = true;
		joinCode = code;
		mode = 'join';
	});
	let size = $state<TableSize>(6);
	let antiDeclare = $state(false);

	const trimmed = $derived(name.trim());
	const ready = $derived(
		trimmed.length > 0 && (mode === 'create' || joinCode.trim().length === CODE_LENGTH)
	);

	/* Shown up front so the uneven four- and eight-player deals are never a surprise. */
	const deal = $derived(handSizes(size));
	const dealLabel = $derived(
		new Set(deal).size === 1 ? `${deal[0]} cards each` : `${deal.join(' / ')} cards`
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!ready) return;
		if (mode === 'create') onCreate(trimmed, size, antiDeclare);
		else onJoin(joinCode.trim().toUpperCase(), trimmed);
	}
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-10 sm:gap-12 sm:py-16">
	<PageHeader title="Literature" eyebrow="Fish · 4–8 players · teams" />

	<form onsubmit={submit} class="flex w-full max-w-lg flex-col gap-6">
		<div>
			<label for="name" class="mb-1 block font-mono text-xs tracking-[0.14em] text-muted uppercase">
				Your name
			</label>
			<Input id="name" bind:value={name} maxlength={MAX_NAME_LENGTH} placeholder="e.g. Josh" />
		</div>

		<div class="grid grid-cols-2 gap-2">
			{#each [{ id: 'create', label: 'New game' }, { id: 'join', label: 'Join a game' }] as tab (tab.id)}
				<button
					type="button"
					onclick={() => (mode = tab.id as typeof mode)}
					class="min-h-11 cursor-pointer border bg-transparent px-3 font-mono text-xs tracking-[0.12em] uppercase transition-[border-color,color] select-none sm:min-h-10 {mode ===
					tab.id
						? 'border-accent text-accent'
						: 'border-border text-muted hover:border-muted hover:text-text'}"
				>
					{tab.label}
				</button>
			{/each}
		</div>

		{#if mode === 'join'}
			<div>
				<label
					for="code"
					class="mb-1 block font-mono text-xs tracking-[0.14em] text-muted uppercase"
				>
					Room code
				</label>
				<Input
					id="code"
					bind:value={joinCode}
					maxlength={CODE_LENGTH}
					autocapitalize="characters"
					autocomplete="off"
					spellcheck={false}
					placeholder="ABCD"
					class="text-center text-xl tracking-[0.4em] uppercase sm:text-xl"
				/>
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				<div>
					<p class="mb-1 font-mono text-xs tracking-[0.14em] text-muted uppercase">Players</p>
					<div class="grid grid-cols-3 gap-2">
						{#each TABLE_SIZES as option (option)}
							<button
								type="button"
								onclick={() => (size = option)}
								class="min-h-11 cursor-pointer border bg-bg font-mono text-sm transition-[border-color,color] select-none sm:min-h-10 {size ===
								option
									? 'border-accent text-text'
									: 'border-border text-muted hover:border-muted hover:text-text'}"
							>
								{option}
							</button>
						{/each}
					</div>
					<p class="mt-1.5 text-xs text-muted">
						{size / 2} v {size / 2} · {dealLabel} · 9 sets
					</p>
				</div>

				<label class="flex cursor-pointer items-start gap-3 select-none">
					<input
						type="checkbox"
						bind:checked={antiDeclare}
						class="mt-0.5 h-4 w-4 shrink-0 rounded-none border-border bg-bg text-accent focus:ring-0 focus:ring-offset-0"
					/>
					<span class="min-w-0">
						<span class="block text-sm text-text">Anti-declare</span>
						<span class="block text-xs text-muted">
							Lets you call a set the other team is holding. Get it wrong and they score it, same as
							any declaration.
						</span>
					</span>
				</label>
			</div>
		{/if}

		<Button type="submit" disabled={!ready} class="w-full disabled:opacity-30">
			{mode === 'create' ? 'Create room' : 'Join room'}
		</Button>
	</form>
</div>
