# Bring up the dev stack on port 3002 (Vite proxy → Go API on internal 8080)
run:
    docker compose -f docker-compose.dev.yml up -d --build

# Stop the dev stack
shutdown:
    docker compose -f docker-compose.dev.yml down

# Restart the running container (needed after editing config.json, .env, .air.toml)
restart:
    docker compose -f docker-compose.dev.yml restart app

# Follow logs from the running container
logs:
    docker compose -f docker-compose.dev.yml logs -f

# Open a shell in the running container
shell:
    docker compose -f docker-compose.dev.yml exec app bash

# Run golangci-lint inside the container
lint:
    docker compose -f docker-compose.dev.yml exec app bash -c "cd /app/backend && golangci-lint run ./..."

# Quick health check
health port="3002":
    #!/usr/bin/env bash
    set -euo pipefail
    port={{port}}
    if ! curl -sf --max-time 3 "http://localhost:${port}/api/health" > /dev/null 2>&1; then
        echo "API: NOT responding on ${port}"
        exit 1
    fi
    echo "API: healthy on ${port}"

# Wipe local state (db, thumbs, action log) — keep media untouched
reset:
    rm -rf data/xcleanup.db data/xcleanup.db-shm data/xcleanup.db-wal data/thumbs data/actions.log
