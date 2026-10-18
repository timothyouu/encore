# Sentry implementation verification

Historical source-checkout evidence from the Sentry-only phone implementation based on `694ef65`. Its raw-audio pipeline, test counts, ignored local DSN, and no-backend statement describe that earlier checkout. The combined checkout now uses WAV normalization, artifact upload, temporary retry storage, and backend services; see [combined shipping verification](../../docs/shipping-verification.md) for current evidence. The live synthetic Sentry delivery below was verified for the earlier implementation only.

## Supervised loop

- Isolated checkout: `encore-sentry-work`, based on `694ef65`.
- Implementation owner: Sol high, source and setup documentation only.
- Independent test owner: Sol high, tests only; existing regression behavior stays locked. The only planned boundary-test adjustment is a narrow Sentry browser SDK import allowance.
- Coordinator accepts the combined change and checks the browser flow.
- Verifier: `npm test`, `npm run build`, `git diff --check`, and unchanged `g2/`; privacy/failure/lifecycle tests must pass without a real Sentry connection.
- Stop on success, after three repair cycles, or after the same unresolved failure twice. No unattended automation is scheduled.

## Evidence log

- Baseline: 62/62 tests passed; production build passed after approved dependency installation.
- Accepted units to verify: (1) opt-in SDK and sanitized error monitoring; (2) actual phone pipeline tracing and cleanup; (3) independent regression tests and setup handoff.
- Pre-dispatch account usage: 28% of the 10080-minute Codex window used, reset timestamp 1792881562. This is account-wide and does not isolate this task's cost. Timing coverage starts approximately 06:15 UTC October 18, after initial inspection and dispatch.
- Existing Vite/esbuild dependency audit: one moderate and one high advisory; no forced upgrades performed.
- Final acceptance: 82/82 tests pass (62 baseline plus 20 added cases); TypeScript + Vite production build passes. `git diff --check` passes and `g2/` diff is empty.
- Actual SDK checks use an in-memory transport and synthetic sentinel strings, with no external ingestion. They verify sanitized envelopes, retained child spans/timestamps/status, unique attempt trace IDs, error-to-trace linkage, explicit opt-out and global-error deduplication.
- Review-driven corrections repaired SDK 11 streaming-hook bypass (explicit static lifecycle), trace identity reuse, recorder/cancellation child cleanup, stale-response isolation and duplicate error classification. One supervised implementation pass included these corrections; the final submitted candidate passed the acceptance gate. The three-repair limit was not exhausted.
- Astra independent review: no remaining blocking findings; Sol test author: 82 tests pass. Coordinator browser check: Library → preview → simulated recording → results → History → saved result → History, one completed recording retained, no browser console errors.
- Accepted units: 3/3 for the local phone scope. Backend instrumentation/distributed propagation, actual microphone/service integration and physical G2 remain unverified.
- Measurement ended approximately 06:24 UTC October 18 (about 9 minutes of partial timing coverage). Account-wide usage moved 28% → 35% in the same window (+7 percentage points); other account activity was present, so this is not attributable task cost. No comparative speed/cost claim is made.

## Authorized live smoke test, October 18, 2026 UTC

- In the earlier source checkout, created Encore (`encore-6e`), US storage, and Browser JavaScript project `encore-mobile`. User approved terms, local DSN configuration and synthetic events there. That `.env.local` was ignored by Git and was not copied into the combined checkout.
- One synthetic error and two synthetic transactions returned HTTP 200; SDK flush succeeded. Issue [ENCORE-MOBILE-1](https://encore-6e.sentry.io/issues/7798388780/) displays `analysis:invalid_response`, environment `sentry-smoke-test` and source `demo`.
- The linked trace `9f75f94e42aa49d2b7ddf704b0577ac4` visibly contains root `demo.stop_to_result` and child `phone.analysis_validation`, with the error attached. The screenshot `sentry-live-check.png` remains in the earlier source checkout; it was not copied here. This verifies SDK ingestion in that earlier run, not actual audio/backend execution.
- Billing UI reports no billing details and no payment method on file, with additional spend $0.00. The automatic 14-day trial was started by Sentry; no paid upgrade, payment method or credits purchase was made.
- Sentry inferred geographic attributes server-side. Application payload scrubbing does not prevent server-side IP/geolocation processing.
