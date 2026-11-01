#!/usr/bin/env bash
# Comment card -> passage, edited-passage diff, inbox paging, and the Approved/Discarded
# task statuses (API + browser) against a fresh stack.
#   e2e/comments-inbox/run.sh          build, run every check, tear down
#   KEEP=1 e2e/comments-inbox/run.sh   leave the stack up afterwards
set -euo pipefail
cd "$(dirname "$0")/../.."
STACK="docker compose -p mdocs-comments -f docker-compose.yaml -f e2e/comments-inbox/compose.yml"
export DB_PASSWORD=commentstest
trap '[ -n "${KEEP:-}" ] || $STACK down -v' EXIT
$STACK down -v --remove-orphans
$STACK up -d --build
for i in $(seq 1 90); do
  curl -sf -o /dev/null http://localhost:8094/health && break
  if [ "$i" = 90 ]; then echo "server never became healthy"; $STACK logs server | tail -80; exit 1; fi
  sleep 2
done
status=0
(cd e2e && node comments-inbox/run.mjs) || status=1
(cd e2e && node comments-inbox/statuses.mjs) || status=1
[ "$status" = 0 ] || $STACK logs server | tail -60
exit $status
