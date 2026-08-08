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

Other scripts: `bun test`, `bun run check` (svelte-check), `bun run lint`, `bun run format`,
`bun run build`, `bun run preview`.

The dev server also runs the multiplayer game server on the same port, so `bun run dev` is
all you need to play Literature locally — open a few tabs, or add bots from the lobby.

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

## Multiplayer

Games that need a live backend get one over a WebSocket at `/_ws`, on **the same port** as
the app — one pm2 process, one port. The app itself stays fully prerendered; a WebSocket is a
different protocol and sits outside SvelteKit's router, so there are no server routes.

- `src/server/ws.ts` — `attachGameServer(httpServer)`, the only transport wiring. Dev,
  preview and production all call it, which is what keeps them honest with each other.
- `src/server/rooms.ts` — room registry and the authoritative command handler.
- `src/lib/literature/` — rules, wire protocol, and the redaction boundary. Pure and shared
  by client and server.

Rooms are held in memory, so **a deploy ends any game in progress**. The client detects this
and offers a fresh room rather than hanging.

## Deploying

```sh
./prod.sh
```

Resets to the remote, installs, builds, and applies `ecosystem.config.cjs` with
`pm2 startOrReload`.

Two things worth knowing:

- The entry point is **`server.js`**, not adapter-node's `build/index.js`, because the
  WebSocket needs an `upgrade` handler. pm2 learns that from the committed ecosystem file —
  which is why `prod.sh` applies it rather than running a bare `pm2 restart games`. The first
  deploy after this change may need a one-time `pm2 delete games`.
- **`PORT` defaults to 3001**, to stay clear of the `tools` app on the same host. Change it in
  `ecosystem.config.cjs`.

Whatever fronts the app — Cloudflare tunnel, nginx, anything — must **forward WebSocket
upgrades**. `cloudflared` does by default; nginx needs `proxy_http_version 1.1` plus the
`Upgrade` and `Connection` headers. If the game works in dev and fails in production, this is
the first thing to check.
