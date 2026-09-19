#!/bin/sh
# Every docker compose call on the server goes through here (runbooks/deploy.md):
#   deploy/compose.sh up -d --build      deploy/compose.sh ps      deploy/compose.sh logs --since 2m bot
# It passes the repository-root .env (secrets, POSTGRES_PASSWORD) and bakes the git short sha
# as APP_VERSION, so the heartbeat names exactly what is running.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP_VERSION=$(git -C "$ROOT" rev-parse --short HEAD)
export APP_VERSION
exec docker compose --env-file "$ROOT/.env" -f "$ROOT/deploy/docker-compose.yml" "$@"
