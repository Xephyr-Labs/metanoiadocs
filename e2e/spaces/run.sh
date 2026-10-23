#!/usr/bin/env bash
# Spaces checks (browser + API) against a fresh stack with an empty database.
#   e2e/spaces/run.sh          build, run every check, tear down
#   KEEP=1 e2e/spaces/run.sh   leave the stack up afterwards
set -euo pipefail
cd "$(dirname "$0")/../.."
STACK="docker compose -p mdocs-spaces -f docker-compose.yaml -f e2e/spaces/compose.yml"
export DB_PASSWORD=spacestest
$STACK down -v --remove-orphans
$STACK up -d --build
until curl -sf -o /dev/null http://localhost:8099/health; do sleep 2; done
status=0
(cd e2e && node spaces/spaces.mjs) || status=1
[ -n "${KEEP:-}" ] || $STACK down -v
exit $status
