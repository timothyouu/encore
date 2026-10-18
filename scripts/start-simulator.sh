#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! curl -fsS --max-time 3 http://127.0.0.1:5173/health >/dev/null; then
  echo 'Start bash scripts/start-laptop.sh first.' >&2
  exit 1
fi
for port in 9898 5260; do
  if ss -H -ltn "sport = :$port" | grep -q .; then
    echo "Port $port is already in use. Existing services were preserved." >&2
    exit 1
  fi
done
pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
# WSLg software rendering avoids this laptop's inaccessible D3D device.
LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 GDK_BACKEND=x11
export LIBGL_ALWAYS_SOFTWARE WEBKIT_DISABLE_DMABUF_RENDERER GDK_BACKEND
node g2/node_modules/@evenrealities/evenhub-simulator/bin/index.js http://localhost:5173 --automation-port 9898 &
pids+=("$!")
node scripts/laptop-monitor.mjs &
pids+=("$!")
wait -n "${pids[@]}"
