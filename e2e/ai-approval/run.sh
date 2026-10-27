#!/usr/bin/env bash
# AI edit approval checks (API + browser) against a fresh stack.
#   e2e/ai-approval/run.sh          build, run every check, tear down
#   KEEP=1 e2e/ai-approval/run.sh   leave the stack up afterwards
set -euo pipefail
cd "$(dirname "$0")/../.."
STACK="docker compose -p mdocs-aiapproval -f docker-compose.yaml -f e2e/ai-approval/compose.yml"
export DB_PASSWORD=aiapprovaltest
trap '[ -n "${KEEP:-}" ] || $STACK down -v' EXIT
$STACK down -v --remove-orphans
$STACK up -d --build
for i in $(seq 1 90); do
  curl -sf -o /dev/null http://localhost:8098/health && break
  if [ "$i" = 90 ]; then echo "server never became healthy"; $STACK logs server | tail -80; exit 1; fi
  sleep 2
done
status=0
(cd e2e && node ai-approval/run.mjs) || status=1
[ "$status" = 0 ] || $STACK logs server | tail -60
exit $status
