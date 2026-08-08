/**
 * pm2 configuration, committed so `prod.sh` applies it on every deploy.
 *
 * This exists because the entry point moved: the game needs an `upgrade` handler, which
 * `adapter-node`'s generated `build/index.js` gives no seam for, so `server.js` replaces it.
 * Without pm2 being told, `pm2 restart games` would happily keep running the old entry and
 * the app would work perfectly while every WebSocket connection failed.
 *
 * PORT must not collide with the `tools` app on the same host.
 */
module.exports = {
	apps: [
		{
			name: 'games',
			script: 'server.js',
			env: {
				NODE_ENV: 'production',
				PORT: 3001
			}
		}
	]
};
