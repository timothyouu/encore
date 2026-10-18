#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/verify.sh
(cd server && node --import tsx --test ../acceptance/storage-server.test.mjs)
printf '%s\n' 'Automated storage gates passed. Browser acceptance: mobile/storage-acceptance.html (8 checks); see docs/storage-verification.md.'