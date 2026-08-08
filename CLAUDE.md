# halp/games

Offline-first browser games. SvelteKit 5 (runes mode, forced in `svelte.config.js`),
Tailwind 4, `adapter-node`, prerendered end to end.

## Rules

- **Read `.github/instructions/style-guide.instructions.md` before writing any UI.** It is
  the complete design language: fonts, tokens, component patterns, spacing, motion. Match
  it rather than inventing new styling.
- Runes only — `$state`, `$derived`, `$props`, `$effect`. No stores, no `export let`.
- **Every route stays prerendered** (`src/routes/+layout.ts`). No server load functions, no
  `+server.ts`, no route that needs rendering at request time. A game needing a backend gets
  one over the WebSocket instead — see below.
- Reuse `$lib/components` (`Button`, `Input`, `Kbd`, `PageHeader`, `CopyButton`) and the
  `@theme` tokens in `src/routes/layout.css`. Don't hardcode hex colours — add a token.
- Mobile matters: inputs stay at `text-base` below `sm:` (smaller triggers iOS zoom on
  focus) and tap targets are `min-h-11`.

## Adding a game

Create `src/routes/<slug>/+page.svelte`, then add `{ slug, name, description }` to the
`games` array in `src/lib/games.ts`. The layout shell (header + back link) and the service
worker precache pick it up automatically.

## Multiplayer games

`src/server/` runs a WebSocket server on **the same port** as the app, attached to the same
`http.Server` — see `attachGameServer` in `src/server/ws.ts`. Dev, `vite preview` and
production all call that one function, so there is no deploy-only code path.

- The socket lives at `/_ws`. The upgrade handler must **return without touching** sockets it
  does not claim; destroying them kills Vite's HMR socket, which shares `/` in dev.
- Prerendering is unaffected — a WebSocket is a different protocol, outside SvelteKit's
  router. Rooms with a code go in a query param (`?r=CODE`), because a dynamic `[code]`
  segment can't be prerendered. Reading `url.searchParams` needs a `browser` guard.
- The server is authoritative and holds all hidden state. Exactly one function turns room
  state into what a client may see (`toPlayerView`); nothing else may serialise game state.
  Bots go through it too, which is what stops them seeing more than a human.
- Command handlers stay **synchronous**. That is what serialises simultaneous actions; an
  `await` inside one silently reopens a race.
- Rooms are in-memory, so a deploy ends any game in progress. Clients handle
  `ROOM_NOT_FOUND` by offering a new room.
- Production runs `server.js`, not adapter-node's `build/index.js`. pm2 learns that from the
  committed `ecosystem.config.cjs`, which `prod.sh` applies.

## Verify before claiming done

```sh
bun test && bun run check && bun run lint && bun run build
```
