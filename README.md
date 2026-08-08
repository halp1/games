# halp/games

A small collection of fast, offline-capable browser games. SvelteKit 5 (runes) + Tailwind 4,
fully prerendered and precached by a service worker, so every game opens cold while offline.

Shares its design language with [halp/tools](../tools) — see
[`.github/instructions/style-guide.instructions.md`](.github/instructions/style-guide.instructions.md).

## Developing

```sh
bun install
bun run dev
```

Other scripts: `bun run check` (svelte-check), `bun run lint`, `bun run format`,
`bun run build`, `bun run preview`.

## Adding a game

1. Create `src/routes/<slug>/+page.svelte`. It inherits the shell: the sticky
   `HALP/GAMES` header and a back arrow to the index appear automatically on any route
   that is not `/`.
2. Add a matching entry to the `games` array in [`src/lib/games.ts`](src/lib/games.ts):

   ```ts
   export const games: Game[] = [
   	{ slug: 'my-game', name: 'My Game', description: 'One line about how it plays.' }
   ];
   ```

3. Build UI from `$lib/components` (`Button`, `Input`, `Kbd`, `PageHeader`, `CopyButton`)
   and the theme tokens in `src/routes/layout.css`. Follow the style guide.

Nothing else needs wiring. The route is prerendered at build time and the service worker
precaches it, so it works offline from a cold start.

Keep game state client-side — `prerender = true` is set for the whole app in
`src/routes/+layout.ts`, so there are no server endpoints or load functions that hit a
backend. Persist to `localStorage` if a game needs to survive a reload.

## Icons

`static/icons/*` and `static/favicon.ico` are generated and committed. Re-run after
changing the mark:

```sh
node scripts/generate-icons.mjs
```

## Deploying

`adapter-node`, run under pm2 as `games`:

```sh
./prod.sh
```

That resets to the remote, installs, builds, and restarts the pm2 process. `node build`
listens on `$PORT` (default 3000) — set it in the pm2 config so it does not collide with
the `tools` app on the same host.
