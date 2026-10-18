#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .run
for port in 5173 8788 8002; do
  if ss -H -ltn "sport = :$port" | grep -q .; then
    echo "Port $port is already in use. Existing services were preserved." >&2
    exit 1
  fi
done
# Provider credentials stay backend-only in server/.env. Offline coaching is opt-in.
export ENCORE_OFFLINE=false
if [[ "${1:-}" == "--fallback" && "$#" == 1 ]]; then
  export ENCORE_OFFLINE=true
elif [[ "$#" != 0 ]]; then
  echo 'Usage: bash scripts/start-laptop.sh [--fallback]' >&2
  exit 2
fi
export ENCORE_COACH_HOST=127.0.0.1
export ENCORE_COACH_PORT=8788
export ENCORE_ALLOWED_ORIGIN=http://localhost:5173
export ENCORE_ANALYSIS_URL=http://127.0.0.1:8002/v1/analyze
unset ENCORE_COACH_TOKEN ENCORE_PUBLIC_BASE_URL VITE_ENCORE_API_ORIGIN
pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
analysis/.venv/bin/python -m uvicorn analysis.service:app --host 127.0.0.1 --port 8002 >.run/laptop-analysis.log 2>&1 &
pids+=("$!")
(cd server && exec node --import tsx src/main.ts) >.run/laptop-backend.log 2>&1 &
pids+=("$!")
(cd g2 && exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort) >.run/laptop-frontend.log 2>&1 &
pids+=("$!")
echo 'Encore phone + glasses host: http://localhost:5173'
echo 'Backend: http://localhost:8788/health; Basic Pitch: http://localhost:8002/health'
if [[ "$ENCORE_OFFLINE" == true ]]; then
  echo 'Coaching: explicit offline fallback.'
else
  echo 'Coaching: Gemini enabled when server/.env is configured; see /health for provider readiness.'
fi
echo 'Logs: .run/laptop-*.log. Ctrl-C stops this stack.'
wait -n "${pids[@]}"
