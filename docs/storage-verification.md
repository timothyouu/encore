# Encore local storage implementation and verification

Outcome: accepted local-history/temporary-audio architecture implemented and verified in isolated WSL worktree `/home/tim/projects/encore-storage`, branch `codex/local-storage-retention`. The Windows checkout's `encore/spec.md` was also updated. No commit, push, deployment, package installation, credential access, or live provider call was performed.

## Scope and ownership

- `mobile/src/storage.ts`: IndexedDB backend, serialized state persistence, validated legacy migration, keyed corrupt-row cleanup, temporary WAV storage, expiry timers and capacity limits.
- `mobile/src/session.ts`, `settings.ts`, `main.ts`: async hydration before capture UI, persistence warnings, settings/history adapters and 1,000-attempt safety cap.
- `mobile/src/capture.ts`: normalized WAV durable save before upload; reload-safe explicit retry; one attempt/count; terminal-result deletion; bounded memory and durable retry windows.
- `server/src/recordings.ts`, `http.ts`: immutable artifact identity, idle cleanup, 10-minute upper lifetime, 60-second completed/skipped grace, bounded consumer responses, stale responses return 410, shutdown cleanup.
- Tests: `mobile/tests/storage.test.mjs`, additions to `capture.test.mjs`, `server/src/recordings.test.ts`, additions to `coaching.test.ts`, coordinator-owned `acceptance/storage-server.test.mjs`, `mobile/storage-browser.ts`, `mobile/storage-acceptance.html`.
- Methodology: `STORAGE-LOOP.md`; runner: `scripts/verify-storage.sh`.

This worktree starts at 37428f7 and includes a preserved overlay of existing uncommitted renderer/visual-plan changes from encore-wav-flow. Those changes in paper-contract, paper-renderer tests, phone.ts, visual-plan tests/schema/source are not attributed to this task. Existing Windows Sentry work and the original WSL pipeline were not overwritten. g2 is unchanged. Existing approved node_modules and Python environment are symlinked from encore-wav-flow; keep those environments available.

## Policy

No real accounts or cloud profiles. History/settings stay local. Audio is temporary and distinct from results. Retry window: 10 minutes from initial capture/save, 24 clips / 32 MiB. Server receipt expiry is an upper bound: completed work may be purged earlier after 60 seconds. Server storage is in memory; restart requires same-attempt reupload from the phone's unexpired copy. History never makes network/model calls. IndexedDB failure is surfaced and usable session-only operation remains bounded. No permanent playback or cross-device backup promise.

## Verification on final tree

`bash scripts/verify.sh` and `(cd server && node --import tsx --test ../acceptance/storage-server.test.mjs)` passed. Equivalent rerun: `bash scripts/verify-storage.sh`.

- Server: 25 tests, typecheck passed.
- Mobile: 133 tests, strict TypeScript and Vite build passed.
- Python analysis: 14 tests passed.
- Python acceptance: 4 tests passed.
- Existing independent Paper contract: 8 tests passed.
- Fixed server storage acceptance: 5 tests passed.
- Total automated tests: 189 passed, zero failed. `git diff --check` passed; g2 diff empty.

Browser: run `cd mobile && npm run dev -- --port 5182 --strictPort`, then open `http://localhost:5182/storage-acceptance.html` and click Run storage acceptance. Chromium real IndexedDB passed 8/8: migration/serialized writes/recreation; settings persistence; binary structured clone; non-renewing TTL; failed-upload controller recreation and successful retry with one count and raw deletion; cap refusal without eviction; corrupt-row physical deletion; session-memory expiry. WAV is generated and network responses are explicitly stubbed; this is not live AI or microphone evidence.

The actual UI was also exercised in labeled Demo mode: Library -> preview -> simulated capture -> result -> History -> saved read-only result. An explicit full reload preserved exactly one completed recording and its structured result. Screenshot: Windows encore-local/storage-acceptance.png.

## Loop and review

Initial baseline verification passed. Implementation used two Sol workers with separate mobile/server ownership and a separate Sol integration reviewer. Coordinator-owned acceptance assertions were not editable by workers. Two focused correction batches resolved renewable local TTL, open-tab retention, corrupt rows, 1,001st-record loss, and late server responses after expiry. The browser harness required one fixture-isolation correction: refresh its adapter after a different adapter deleted a shared synthetic row. No acceptance assertion was weakened. Development hot reload interrupted early browser runs; final pass used frozen sources. Full-page screenshot capture timed out once; viewport capture succeeded.

All four acceptance units accepted: spec, local persistence/retry, server retention, independent integration verification. Independent reviewer reran 133 mobile + 25 server + 5 fixed tests and build/typecheck, with no remaining actionable findings. Six-iteration maximum was not reached; stopped after passing gates.

## Limits and follow-up decisions

- Physical phone/Even WebView IndexedDB persistence, app lifecycle, eviction, and G2 capture remain unverified. Mobile imports no Even SDK and does not control glasses.
- No live Gemini or real microphone calls were made; storage tests use synthetic WAV and stubbed responses. Existing analysis unit tests ran.
- Expiry removes Encore-held artifacts; an already-delivered third-party copy that ignores abort may outlive our store. No external-provider deletion claim.
- Multiple simultaneously active tabs are not a cross-device/synchronization product; this demo assumes one active client writer. Browser local data may be cleared or evicted.
- This historical storage-only run preceded Sentry integration. The combined shipping verification is recorded in `shipping-verification.md`; the original source worktrees remain preserved.
- Longer playback, accounts, cloud backup and Supabase provisioning remain future explicit scope.

Measurement: normalized account allowance baseline 37% used in the 10080-minute Codex window at approximately 06:31 UTC on October 18. Completion at 06:42:13 UTC: 43% used in the same window/reset boundary, an observed +6 percentage points over approximately 11 minutes of measured execution. Account-wide counters include other chats and cannot be attributed precisely to this task; no speed/cost improvement claim.