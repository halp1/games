/**
 * Production entry. One process, one port, serving both the app and the game.
 *
 * `adapter-node` normally ships its own `build/index.js`, but that gives no seam for an
 * `upgrade` handler. So this replaces it: the same exported `handler` middleware serves every
 * HTTP request, and the WebSocket server is attached to the same `http.Server` — which is why
 * the game needs no second port and no second pm2 process.
 *
 * Deliberately plain JavaScript and not bundled: it is the one file that has to reference
 * generated build output, and keeping it readable is worth more than the consistency.
 *
 *   bun run build   →   build/handler.js (SvelteKit)  +  build/ws.js (esbuild)
 *   node server.js
 */
import http from 'node:http';
import { handler } from './build/handler.js';
import { WS_PATH, attachGameServer } from './build/ws.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

const server = http.createServer((req, res) => {
	handler(req, res, () => {
		res.statusCode = 404;
		res.end('Not found');
	});
});

attachGameServer(server);

/* Registered after the game server, so it only ever sees upgrades nothing claimed. Unlike in
   dev — where Vite's HMR socket is also listening — nothing else here has a use for them. */
server.on('upgrade', (req, socket) => {
	let pathname = '/';
	try {
		pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
	} catch {
		/* Malformed request line; fall through and close. */
	}
	if (pathname !== WS_PATH) socket.destroy();
});

server.listen(port, host, () => {
	console.log(`halp/games listening on http://${host}:${port} (websocket ${WS_PATH})`);
});

/* pm2 sends SIGINT on restart and SIGTERM on stop. Close the listener so in-flight requests
   finish, but do not wait on open WebSockets — they would never close on their own. */
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		server.close(() => process.exit(0));
		server.closeIdleConnections?.();
		setTimeout(() => process.exit(0), 5_000).unref();
	});
}
