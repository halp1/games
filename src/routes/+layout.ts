/* Every game runs entirely in the browser, so the whole app is prerendered to static
   HTML. That is what lets the service worker precache each route and open it cold while
   offline, rather than only reaching it through client-side navigation. */
export const prerender = true;
