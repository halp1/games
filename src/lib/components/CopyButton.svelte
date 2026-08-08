<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';
	import Button from './Button.svelte';

	interface Props {
		text: string;
		label?: string;
		class?: string;
	}

	let { text, label = 'Copy', class: className }: Props = $props();

	let copied = $state(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			// clipboard not available
		}
	};
</script>

<Button onclick={copy} class={className}>
	{#if copied}
		<Check size={14} />
		Copied
	{:else}
		<Copy size={14} />
		{label}
	{/if}
</Button>
