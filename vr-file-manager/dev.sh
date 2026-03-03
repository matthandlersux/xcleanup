#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

cleanup() {
    echo ""
    echo "Shutting down..."
    # Kill all processes in our process group (includes all children)
    kill -TERM 0 2>/dev/null
}

trap cleanup INT TERM
trap 'kill 0 2>/dev/null; wait 2>/dev/null' EXIT

cd server && npx tsx watch src/index.ts &
cd web && npx vite &

echo "Press Ctrl+C to stop"
wait
