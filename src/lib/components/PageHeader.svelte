<script lang="ts">
	interface Props {
		title: string;
		eyebrow?: string;
	}

	let { title, eyebrow }: Props = $props();
</script>

<div class="flex flex-col items-center gap-2">
	{#if eyebrow}
		<p class="text-xs tracking-[0.18em] text-muted uppercase">{eyebrow}</p>
	{/if}
	<h1 class="text-center font-heading text-3xl text-text sm:text-4xl">{title}</h1>
</div>
