import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { attachGameServer } from './src/server/ws';

/**
 * Runs the Literature WebSocket server on the dev and preview servers, using the same
 * `attachGameServer` production uses. Without this the game would only work in a built
 * deployment, which is the fastest way to end up with dev-only bugs.
 */
function gameServer(): Plugin {
	/* The server is pulled into Vite's *config* module graph, not the app's, so editing it
	   does not trigger HMR — the old code would keep running invisibly. Restart instead.
	   `.svelte.ts` is excluded because that is client-side runes code, which HMR handles. */
	const isServerCode = (file: string) =>
		file.includes('/src/server/') ||
		(file.includes('/src/lib/literature/') && !file.endsWith('.svelte.ts'));

	return {
		name: 'literature-game-server',
		configureServer(server) {
			if (server.httpServer) attachGameServer(server.httpServer);
			server.watcher.on('change', (file) => {
				if (isServerCode(file)) server.restart();
			});
		},
		configurePreviewServer(server) {
			attachGameServer(server.httpServer);
		}
	};
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), gameServer()],
	ssr: {
		noExternal: ['@lucide/svelte']
	}
});
