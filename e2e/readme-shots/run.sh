#!/bin/bash
# Fresh workspace, seeded and backdated, ready for shots.mjs. Destroys the
# mdocs-shots stack's database each time; it holds nothing but this demo.
set -euo pipefail
cd "$(dirname "$0")/../.."
STACK="docker compose -p mdocs-shots -f docker-compose.yaml -f e2e/readme-shots/compose.yml"
export DB_PASSWORD=shots
$STACK down -v --remove-orphans
$STACK up -d --build
until curl -sf -o /dev/null http://localhost:8097/health; do sleep 2; done
(cd e2e && node readme-shots/seed.mjs > /dev/null)
docker exec -i mdocs-shots-db-1 psql -q -v ON_ERROR_STOP=1 -U metanoia -d metanoiadocs < e2e/readme-shots/backdate.sql
(cd e2e && node readme-shots/shots.mjs)
