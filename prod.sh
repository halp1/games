#!/bin/bash

set -e

git reset HEAD --hard
git pull
bun i
bun run build
# startOrReload rather than restart: the entry point is server.js, not adapter-node's
# build/index.js, and pm2 only learns that from the committed ecosystem file. A plain
# `pm2 restart games` would keep running the old entry with no websocket.
pm2 startOrReload ecosystem.config.cjs --update-env
