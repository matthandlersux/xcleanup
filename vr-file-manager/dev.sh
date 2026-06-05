#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

cleanup() {
    trap - INT TERM EXIT
    echo ""
    echo "Shutting down..."
    kill 0 2>/dev/null
    wait 2>/dev/null
}

trap cleanup INT TERM EXIT

cd server && npx tsx watch src/index.ts &
cd web && npx vite &

echo "Press Ctrl+C to stop"
wait
