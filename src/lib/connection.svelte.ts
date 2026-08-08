/**
 * A single place for "is this page talking to a server right now", read by the app shell so
 * the indicator lives in the header rather than being redrawn by every game.
 *
 * Games that need a live connection set `connection.status` and clear it on the way out;
 * single-player games never touch it and the header stays as it was.
 */
export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'offline';

export const connection = $state<{ status: ConnectionStatus | null }>({ status: null });

export function setConnection(status: ConnectionStatus | null): void {
	connection.status = status;
}

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
	connecting: 'Connecting',
	open: 'Live',
	reconnecting: 'Reconnecting',
	offline: 'Offline'
};

/** Lime for good, amber for in-between, red for gone — the palette's existing vocabulary. */
export const CONNECTION_TONE: Record<ConnectionStatus, string> = {
	connecting: 'bg-warning',
	open: 'bg-accent',
	reconnecting: 'bg-warning',
	offline: 'bg-danger'
};

export const CONNECTION_TEXT: Record<ConnectionStatus, string> = {
	connecting: 'text-warning',
	open: 'text-muted',
	reconnecting: 'text-warning',
	offline: 'text-danger'
};
