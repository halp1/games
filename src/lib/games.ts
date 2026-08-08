/**
 * The single source of truth for what appears on the home page.
 *
 * Adding a game is two steps: create `src/routes/<slug>/+page.svelte`, then add an entry
 * here whose `slug` matches the directory name. Nothing else wires them together — the
 * route is prerendered and precached automatically by virtue of existing.
 */
export interface Game {
	/** Must match the route directory under `src/routes`. */
	slug: string;
	name: string;
	description: string;
}

export const games: Game[] = [];
