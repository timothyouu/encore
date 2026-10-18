# Combined shipping verification

Integration checkout: `/home/tim/projects/encore-ship`, branch `codex/ship-local-ai-storage-sentry`.

Scope: normalized WAV upload and shared-artifact Basic Pitch/Strands/Gemini coaching; evidence-based deterministic Paper visualizations; local IndexedDB history/settings and bounded temporary audio; opt-in sanitized phone Sentry monitoring. Original Windows and WSL source checkouts are preserved. No G2 runtime changes are included.

The storage worktree already contained the final Paper source overlay. Its remaining renderer documentation was added from the WAV worktree. Sentry was integrated at the new normalization/upload/persistence seams instead of replacing those files with older versions.

## Merge resolution

Upstream `129501a` was integrated, then teammate G2 test PR #13 (`4da611a`) merged cleanly during final verification. Specification conflicts preserve both the two-model WAV pipeline and upstream finding-specific visuals. The G2 state/gesture/menu sections match upstream; phone settings remain local preferences, with device application deferred to the glasses owner. Runtime G2 diff against origin/main is empty.

## Evidence collected in this run

- Independent Astra review: server 25 tests/typecheck, storage-server acceptance 5, Python analysis 14, duration acceptance 4, Paper acceptance 8, and exact passage synchronization passed.
- Real Basic Pitch synthetic smoke: P01 and P02 matched 8/8 reference notes each.
- Real local HTTP acceptance: normalized synthetic WAV hash, idempotent artifact identity, real Basic Pitch, and explicitly labeled offline fallback passed.
- Real Chromium IndexedDB acceptance: 8/8 passed (migration, serialization/recreation, settings, binary clone, fixed TTL, retry/count/delete, capacity, corrupt-row cleanup, and session fallback grouped into eight checks). Network responses are stubbed in this harness.
- Existing Sentry synthetic issue and linked demo root/analysis-validation child were inspected in the live dashboard. This rechecks prior ingestion; it is not a newly emitted combined-code event.
- First authorized live Gemini smoke: configured provider, real analysis 8/8, one coaching call returned labeled fallback with `model_error`. No retries were made in that test. Further diagnosis recorded below.

## Boundaries

Real `.env` files, dependencies, runtime logs and audio stay ignored. Only `.env.example` templates belong in the PR. No package installation or deployment was performed. Physical microphone quality, phone/Even WebView lifecycle, G2 transport, and backend/distributed Sentry tracing are not established by these tests.

## Final acceptance

Local acceptance passed: 214 automated tests (26 server, 157 mobile, 14 Python analysis, 4 duration, 8 Paper, 5 storage-server), server/mobile strict typechecks and production build. The combined runner reached its ownership guard just after upstream G2 changed, correctly reported a boundary mismatch, and stopped before storage-server acceptance. After integrating upstream, the exact G2 comparison, passage check and remaining 5 acceptance tests passed. Unchanged test evidence was reused; the final server suite was rerun after model configuration edits.

Chromium verified Library -> preview -> labeled simulated recording -> result -> correction/replay -> History -> full reload -> saved read-only result. Exactly one recording persisted; browser warning/error log was empty. Independent Astra review identified one stale asynchronous cleanup telemetry attribution bug; Sol fixed it with generation isolation and a regression test. No remaining blocking review findings.

Live Gemini diagnosis: the first three authorized requests using 2.5 Flash failed; safe diagnostics identified provider HTTP404 before response chunks. Google's current model policy restricts 2.5 access to prior active users. With explicit user approval, only the local model setting changed to `gemini-3.5-flash-lite`; key/project and quota controls stayed unchanged. The fourth and final authorized request succeeded through Strands: exact 441,044-byte WAV/hash retained, `coachingSource: gemini`, valid attempt/evidence/reference IDs, normal STOP, 726 input + 24 output tokens. There were no automatic retries or model fallback. A standalone full-plan validator initially failed to import the module; corrected local synthetic replay passed schema and deterministic reconstruction without another provider request. Do not present that replay as validation of the exact live full plan.

The repository allows explicit selection of 3.5 Flash-Lite or legacy 2.5 Flash; it never silently switches models. JSON response mode and a 512-token output cap support the bounded action contract. Free-tier eligibility remains an operator/project responsibility.

References: [Google model-access notice](https://ai.google.dev/gemini-api/docs/deprecations.md), [3.5 Flash-Lite audio/JSON capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [Free-tier pricing](https://ai.google.dev/gemini-api/docs/pricing.md).

PR and remote merge verification are recorded in the final chat/local workspace handoff.

## Coordination record

Astra high independently reviewed pipeline/storage; Sol high integrated Sentry. Three acceptance units: pipeline/storage integration, Sentry/mobile integration, and reviewed PR merge. Measurement starts 2026-10-18 06:44:58 UTC at account-wide 44% used in the 10080-minute window (reset 1792881562). Other account activity is unknown; no performance comparison or per-task cost claim.
