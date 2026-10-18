#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
(cd server && npm test && npm run typecheck)
(cd mobile && npm test && npm run build)
analysis/.venv/bin/python -m unittest discover -s analysis/tests -v
analysis/.venv/bin/python -m unittest discover -s acceptance -v
node --experimental-strip-types --test acceptance/paper-contract.test.mjs
node --experimental-strip-types scripts/sync-passages.mjs --check
if ! git diff --quiet "${ENCORE_BOUNDARY_BASE:-origin/main}" -- g2; then
  echo 'Glasses ownership boundary changed; review required.' >&2
  exit 1
fi
