#!/usr/bin/env bash
# Google Calendar connector checks (API + browser) against a fresh stack with a Google stub.
#   e2e/calendar/run.sh          build, run every check, tear down
#   KEEP=1 e2e/calendar/run.sh   leave the stack up afterwards
set -euo pipefail
cd "$(dirname "$0")/../.."
STACK="docker compose -p mdocs-calendar -f docker-compose.yaml -f e2e/calendar/compose.yml"
export DB_PASSWORD=calendartest
trap '[ -n "${KEEP:-}" ] || $STACK down -v' EXIT
$STACK down -v --remove-orphans
$STACK up -d --build
for i in $(seq 1 90); do
  curl -sf -o /dev/null http://localhost:8095/health && curl -sf -o /dev/null http://localhost:8101/stats && break
  if [ "$i" = 90 ]; then echo "stack never became healthy"; $STACK logs server | tail -80; exit 1; fi
  sleep 2
done
status=0
(cd e2e && node calendar/run.mjs) || status=1
[ "$status" = 0 ] || $STACK logs server | tail -60
exit $status
