#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Provider credentials are loaded only from server/.env by the backend.
export ENCORE_OFFLINE=false
if [[ "${1:-}" == "--fallback" ]]; then
  export ENCORE_OFFLINE=true
fi
export ENCORE_COACH_HOST=127.0.0.1
export ENCORE_COACH_PORT=8788
export ENCORE_ALLOWED_ORIGIN=http://localhost:5176
export ENCORE_ANALYSIS_URL=http://127.0.0.1:8002/v1/analyze
mkdir -p .run
pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
analysis/.venv/bin/python -m uvicorn analysis.service:app --host 127.0.0.1 --port 8002 >.run/analysis.log 2>&1 &
pids+=("$!")
(cd server && exec node --import tsx src/main.ts) >.run/server.log 2>&1 &
pids+=("$!")
(cd mobile && exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort) >.run/mobile.log 2>&1 &
pids+=("$!")
echo 'Encore: http://localhost:5176. Local logs: .run/. Ctrl-C stops this launcher.'
wait -n "${pids[@]}"
