<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { twMerge } from 'tailwind-merge';

	let { class: className, value = $bindable<string>(''), ...rest }: HTMLInputAttributes = $props();
</script>

<input
	{...rest}
	bind:value
	class={twMerge(
		// text-base (16px) below sm: anything smaller makes iOS Safari zoom in on focus.
		'min-h-11 w-full min-w-0 rounded-none border border-border bg-bg px-3 py-2 font-mono text-base text-text ring-0 transition-[border-color,width] duration-200 outline-none placeholder:text-[#333] focus-within:border-accent focus:border-accent sm:min-h-0 sm:text-sm',
		className as string
	)}
/>
