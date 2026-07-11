#!/usr/bin/env bash
# Legacy helper: force-free port 4000 before a dev server starts.
# `npm run dev` uses scripts/dev-autoport.mjs instead (picks the next free port).
set -euo pipefail

PORT="${1:-4000}"

if ! command -v lsof >/dev/null 2>&1; then
  exit 0
fi

pids="$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"

if [[ -z "$pids" ]]; then
  exit 0
fi

echo "Port $PORT is in use, freeing it for the dev server..."
while IFS= read -r pid; do
  [[ -z "$pid" ]] && continue
  cmd="$(ps -p "$pid" -o comm= 2>/dev/null || true)"
  echo "  killing pid $pid ($cmd)"
  kill "$pid" 2>/dev/null || true
done <<< "$pids"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [[ -z "$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)" ]]; then
    exit 0
  fi
  sleep 0.3
done

# Still held after a graceful attempt: force kill.
pids="$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
while IFS= read -r pid; do
  [[ -z "$pid" ]] && continue
  echo "  pid $pid didn't exit, sending SIGKILL"
  kill -9 "$pid" 2>/dev/null || true
done <<< "$pids"
