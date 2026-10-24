#!/usr/bin/env bash
# Voice-note checks against a fresh stack: Chromium with a fake microphone
# (--use-fake-device-for-media-stream), so nothing needs a real mic.
#   e2e/voice-notes/run.sh          build, run every check, tear down
#   KEEP=1 e2e/voice-notes/run.sh   leave the stack up afterwards
set -euo pipefail
cd "$(dirname "$0")/../.."
STACK="docker compose -p mdocs-voice -f docker-compose.yaml -f e2e/voice-notes/compose.yml"
export DB_PASSWORD=voicetest
$STACK down -v --remove-orphans
$STACK up -d --build
until curl -sf -o /dev/null http://localhost:8098/health; do sleep 2; done
status=0
for check in basics people-and-tasks review-1 review-2 cleanup-and-send transcripts; do
  echo "== $check"
  (cd e2e && node "voice-notes/$check.mjs") || status=1
done
[ -n "${KEEP:-}" ] || $STACK down -v
exit $status
