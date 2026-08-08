# halp/games

Offline-first browser games. SvelteKit 5 (runes mode, forced in `svelte.config.js`),
Tailwind 4, `adapter-node`, prerendered end to end.

## Rules

- **Read `.github/instructions/style-guide.instructions.md` before writing any UI.** It is
  the complete design language: fonts, tokens, component patterns, spacing, motion. Match
  it rather than inventing new styling.
- Runes only — `$state`, `$derived`, `$props`, `$effect`. No stores, no `export let`.
- The whole app is prerendered (`src/routes/+layout.ts`). No server load functions, no API
  routes, nothing that needs a backend at runtime.
- Reuse `$lib/components` (`Button`, `Input`, `Kbd`, `PageHeader`, `CopyButton`) and the
  `@theme` tokens in `src/routes/layout.css`. Don't hardcode hex colours.
- Mobile matters: inputs stay at `text-base` below `sm:` (smaller triggers iOS zoom on
  focus) and tap targets are `min-h-11`.

## Adding a game

Create `src/routes/<slug>/+page.svelte`, then add `{ slug, name, description }` to the
`games` array in `src/lib/games.ts`. The layout shell (header + back link) and the service
worker precache pick it up automatically.

## Verify before claiming done

```sh
bun run check && bun run lint && bun run build
```
