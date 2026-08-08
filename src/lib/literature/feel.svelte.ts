/**
 * The two platform touches that separate a web page from something that feels like an app:
 * the screen not sleeping while you are thinking, and the phone answering back when
 * something happens to your hand.
 *
 * Both are best-effort. Wake Lock is unavailable on some browsers and can be refused;
 * `navigator.vibrate` does not exist on iOS Safari at all. Neither is worth a fallback and
 * neither should ever throw, so both fail silently.
 */
import { browser } from '$app/environment';

/**
 * Holds a screen wake lock for as long as `active()` returns true.
 *
 * Call from component initialisation — it installs its own `$effect`. The lock is dropped by
 * the browser whenever the page is hidden, so it is re-acquired on `visibilitychange`;
 * without that, one glance at another app ends it for the rest of the game.
 */
export function keepAwake(active: () => boolean): void {
	$effect(() => {
		if (!browser || !active()) return;

		let lock: WakeLockSentinel | null = null;
		let released = false;

		const acquire = async () => {
			if (released || document.visibilityState !== 'visible') return;
			try {
				lock = (await navigator.wakeLock?.request('screen')) ?? null;
			} catch {
				/* Refused, unsupported, or the tab lost focus mid-request. Not worth reporting. */
			}
		};

		const onVisible = () => {
			if (document.visibilityState === 'visible') void acquire();
		};

		void acquire();
		document.addEventListener('visibilitychange', onVisible);

		return () => {
			released = true;
			document.removeEventListener('visibilitychange', onVisible);
			void lock?.release().catch(() => {});
		};
	});
}

/**
 * Whether the browser thinks it has a connection.
 *
 * Worth tracking separately from the socket: the service worker precaches the whole app, so
 * the page opens perfectly well on a train and then simply cannot reach a game. "You are
 * offline" is a much better answer than a spinner that never resolves.
 */
export const network = $state({ online: true });

export function watchNetwork(): void {
	$effect(() => {
		network.online = navigator.onLine;
		const up = () => (network.online = true);
		const down = () => (network.online = false);
		addEventListener('online', up);
		addEventListener('offline', down);
		return () => {
			removeEventListener('online', up);
			removeEventListener('offline', down);
		};
	});
}

/** Vibration patterns, kept together so the game speaks with one vocabulary. */
export const BUZZ = {
	/** Your turn has come round. */
	turn: 18,
	/** Someone took a card off you. */
	lost: [12, 40, 12],
	/** A set was just resolved, one way or the other. */
	resolved: [24, 40, 24]
} as const;

export function buzz(pattern: number | readonly number[]): void {
	if (!browser) return;
	try {
		navigator.vibrate?.(pattern as number | number[]);
	} catch {
		/* Some browsers throw rather than simply not having it. */
	}
}
