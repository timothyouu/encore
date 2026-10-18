#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
scope="${1:-}"
if [[ "$#" -gt 1 || ( -n "$scope" && "$scope" != "--include-g2" ) ]]; then
  echo 'Usage: bash scripts/verify.sh [--include-g2]' >&2
  exit 2
fi
(cd server && npm test && npm run typecheck)
(cd mobile && npm test && npm run build)
analysis/.venv/bin/python -m unittest discover -s analysis/tests -v
analysis/.venv/bin/python -m unittest discover -s acceptance -v
node --experimental-strip-types --test acceptance/paper-contract.test.mjs
node --experimental-strip-types scripts/sync-passages.mjs --check
if [[ "$scope" == "--include-g2" ]]; then
  # Explicit glasses work verifies that runtime as well; phone boundary tests above remain mandatory.
  (cd g2 && npm test && npm run build)
elif ! git diff --quiet "${ENCORE_BOUNDARY_BASE:-origin/main}" -- g2; then
  echo 'Glasses ownership boundary changed; review required.' >&2
  exit 1
fi
