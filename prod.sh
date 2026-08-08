#!/bin/bash

set -e

git reset HEAD --hard
git pull
bun i
bun run build
pm2 restart games