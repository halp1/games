import { browser } from '$app/environment';

/* Starts false so the prerendered HTML and the first hydration pass agree; `detect()`
   flips it on mount, which is when the Mac labels swap in. */
export const platform = $state({ isMac: false });

export const detectPlatform = () => {
	if (!browser) return;
	/* iPadOS reports itself as a Mac, which is correct here: both use Command. */
	platform.isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
};
