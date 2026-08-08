/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';

/* `$app/environment` is off-limits in a service worker, so dev is detected via Vite. */
const dev = import.meta.env.DEV;

const sw = self as unknown as ServiceWorkerGlobalScope;

/* Versioned, so a deploy never serves a mix of old and new assets. */
const CACHE = `halp-games-${version}`;

/* Hashed app chunks, static files, and the prerendered HTML for every route. Together
   these are the whole app, which is why it works offline from a cold start. */
const PRECACHE = [...build, ...files, ...prerendered];
const PRECACHED = new Set(PRECACHE);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE);
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	/* Vite serves modules straight from disk in dev; caching them just serves stale code. */
	if (dev) return;

	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			/* Precached entries are immutable for this version, so skip the network. */
			if (PRECACHED.has(url.pathname)) {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}

			try {
				const response = await fetch(request);
				if (response.status === 200 && response.type === 'basic') {
					await cache.put(request, response.clone());
				}
				return response;
			} catch {
				const hit = await cache.match(request);
				if (hit) return hit;
				return new Response('Offline', {
					status: 503,
					statusText: 'Offline',
					headers: { 'content-type': 'text/plain' }
				});
			}
		})()
	);
});
