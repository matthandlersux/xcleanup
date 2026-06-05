#!/bin/bash
set -e

cd /app/backend && go mod tidy &
cd /app/frontend && npm install &
wait

mkdir -p /data/thumbs

cd /app/backend && air -c /app/.air.toml &
AIR_PID=$!

cd /app/frontend && npx vite --host 0.0.0.0 --port "${VITE_PORT:-3002}" &
VITE_PID=$!

trap "kill $AIR_PID $VITE_PID 2>/dev/null; exit 0" SIGTERM SIGINT

wait
