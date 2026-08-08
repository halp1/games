<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<kbd class="border border-border bg-bg px-1.5 py-0.5 font-mono text-xs text-text"
	>{@render children()}</kbd
>
