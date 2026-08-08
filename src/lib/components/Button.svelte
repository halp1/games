<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { twMerge } from 'tailwind-merge';

	let {
		children,
		class: className,
		...rest
	}: { children: Snippet } & { value?: string } & HTMLButtonAttributes = $props();
</script>

<button
	{...rest}
	class={twMerge(
		'flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 border bg-accent px-3 py-2 font-mono text-xs tracking-[0.08em] text-text-inverted uppercase transition-all select-none sm:min-h-0',
		className as string
	)}
>
	{@render children?.()}
</button>
