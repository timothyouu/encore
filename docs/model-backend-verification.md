# Model backend integration — October 18, 2026

Completed in `/home/tim/projects/encore-ship`, branch
`codex/ship-local-ai-storage-sentry`, following the user's choice of the existing
WSL app/backend. This checkout already had normalized WAV upload, Basic Pitch,
Strands/Gemini, shared contracts, deterministic Paper visuals, and IndexedDB history.
It uses the shared v1 response plus `visualPlan`; the separate Windows checkout's
v2 segment contract was not transplanted into this app.

## Changes

- `server/src/coaching.ts`: Gemini now receives a native `responseJsonSchema`
  limiting output to three required fields: `findingId`, `actionId`, and
  `componentKind`. Their enums are narrowed to the chosen measured finding and
  its allowed actions. Unknown fields, mismatched values, blocked/truncated
  responses, and incomplete agent turns fail validation. The existing server
  constructs the final `CoachingResult` and `visualPlan` from measured evidence.
  The same WAV remains attached as inline audio. One provider request is allowed;
  SDK retries, continuation, and Strands retries are disabled. Existing quota-stop,
  Free-tier configuration, model choice, and labeled fallback behavior remain.
- `server/src/coaching.test.ts`: outbound schema/audio, malformed JSON, blocked
  responses and strict model choice regression coverage.
- `mobile/src/paper-renderer.ts` and its test: the real detector starts one note
  at beat 1.9934 rather than 2. The visual previously floored the focus window and
  said Beat 2 while the model cue correctly said Beat 3. Note-based headers and
  timing targets now use the cited reference note. Measured deltas stay unchanged.
- `acceptance/live-model.mjs`: explicit `--live` acceptance script for actual HTTP
  upload, Basic Pitch, Gemini, phone validation, grounded visuals and history replay.
  Fallback is a failed live check. It does not read credentials or retry failures.

## Checked results

- Server: 28 tests and TypeScript typecheck passed.
- Phone: 158 tests passed; TypeScript/Vite production build passed.
- Analysis: 14 unit tests passed; 4 duration acceptance tests passed.
- Paper contract: 8 tests passed. Storage/server acceptance: 5 tests passed.
- Passage synchronization and `git diff --check` passed. `git diff HEAD -- g2`
  is empty. The branch already differs from `origin/main` under `g2`; the default
  verification script's remote-base boundary check therefore cannot identify this
  task's changes. No glasses files were changed here.
- One CLI live acceptance and one browser WAV import used the configured
  `gemini-3.5-flash-lite` and actual Basic Pitch 0.4.0 TFLite inference.
  Both selected wrong-note evidence for `P01-N03`, expected E4 and detected F4,
  with `coachingSource: gemini`. No deterministic fallback was counted as success.
  The CLI upload-to-validated-result measurement was 4.06 seconds (one warm sample,
  not a latency benchmark). Browser decoding/normalization was checked separately.
- Browser: WAV import → results → correction → reload → History → correction
  succeeded. Cue and visual both say Beat 3, expected E4, detected F4. No browser
  console errors were captured. See `model-backend-browser.png`.

The storage acceptance initially used Node's strip-types loader, which cannot
resolve this server's `.js` TypeScript imports. Rerunning with its existing `tsx`
loader passed all five checks; no implementation change was needed for that error.

## Repeat locally

Start the existing services with `bash scripts/start-local.sh`. If port 5176 is
occupied, set `ENCORE_MOBILE_PORT` to a free port. The current verification app is
at http://localhost:5193, with backend 8788 and analysis 8002. It uses the existing
ignored `server/.env`; credentials stay in WSL and are not copied to Windows.

Generate the controlled recording (generated tones, not live piano):

```bash
analysis/.venv/bin/python - <<'PY'
import copy
import json
from pathlib import Path
from analysis.smoke import synthetic_wav
passage = copy.deepcopy(json.loads(Path('shared/passages.json').read_text())[0])
passage['notes'][2]['midiPitch'] += 1
Path('.run').mkdir(exist_ok=True)
Path('.run/model-e2e-wrong.wav').write_bytes(synthetic_wav(passage))
PY
node --experimental-strip-types acceptance/live-model.mjs --live .run/model-e2e-wrong.wav
```

Alternatively choose First Steps in the app and import that WAV. The live script
saves its report and raw synthetic-test JSON under ignored `.run/`. The synthetic
tones also trigger supported short-duration findings because they deliberately
end early. These checks do not establish real-piano transcription quality,
microphone behavior, calibration across instruments, or physical glasses behavior.

## Handoff

No commit, push or deployment was performed. Existing provider dependencies and
Python environment were sufficient in the selected WSL checkout. Before that
checkout was selected, an approved Windows backend draft/dependency installation
and separate WSL Python environment were started; those are unused by this app.
The original Windows work was preserved, and no credential was copied between hosts.

Selective delegation: two Sol/high workers handled provider enforcement and
read-only analysis verification; the coordinator handled live HTTP/browser
integration and fixed the observed renderer discrepancy. All three acceptance
units (provider JSON, analysis evidence, app integration) were verified. One
integration correction cycle addressed beat-label drift. Observed account-wide
weekly usage moved from 78% to 82% between 09:32:18 and 09:42:16 UTC; other account
activity is not isolated, so this is not attributable task cost or a speed claim.

## Shipping reconciliation

The previous branch had already been merged, so this work was committed on
`codex/enforce-coaching-json`. Latest `origin/main` at `52c0764` was merged without
text conflicts, preserving the newer phone and G2 integration. The final diff
against main changes only the seven files described above; `g2/` matches main.

Post-merge `bash scripts/verify.sh` passed: 31 server tests, 171 phone tests,
17 analysis tests, 4 Python acceptance tests, 8 Paper contract tests, server
typecheck, phone typecheck/build, passage synchronization and G2 boundary check.
Another 13 storage/shipping integration tests passed with the existing `tsx`
loader. Those integration tests initially lacked the local G2 SDK; linking the
existing dependency directory from `encore-audio-driven` after confirming the
lockfiles were identical resolved the setup issue without installing packages.
No live Gemini request or physical-device test was repeated for this shipping step.
