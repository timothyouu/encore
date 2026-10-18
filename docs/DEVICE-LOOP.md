# Bounded physical-device loop

Outcome: produce a reviewable PR15-based package and evidence for one physical G2 capture -> shared phone processing -> Basic Pitch -> Strands/Gemini -> physical feedback -> exactly one History record. The fixed criteria are [physical-device-verification.md](physical-device-verification.md). A partial local pass never becomes a physical pass.

## Baseline and stop bounds

- Start: PR15 `c09807c`, isolated branch `codex/g2-physical-verify` in `/home/tim/projects/encore-device-verify`.
- Preserve dirty `/home/tim/projects/encore-verify`; no bulk overlay or old standalone-client results attributed to this branch. PR16 is reference only.
- Maximum three focused correction cycles or 45 minutes active execution, excluding user waits. Stop dependent work when the same external blocker recurs twice. Continue useful independent local checks inside the remaining bound.
- No installs, real env/secret reads, commit/push/merge, deployment or broader network permissions are authorized in this loop. Existing exact Funnel scope is preserved.
- Prior real Gemini budget 2/2 exhausted. New authorization permits two additional real calls, same credential/project, only after successful local checks and physical capture. Root owns any authorized credential handling and hard provider-call guard. Agents run offline tests only.
- Allowance baseline:58% used in account-wide 10,080-minute window at 08:02:50 UTC, reset 1792881562. Later deltas include other account activity and are not per-agent costs or proof of efficiency.

## Ownership and coordination

Root owns user interaction, external actions, final integration, provider budget and acceptance. Astra owns this loop record and physical checklist, reviews decisions and evidence, and does not spawn children. Integration owner edits G2 packaging/routing/device seams plus mobile app/connection and related tests. Loop engineer edits backend aliases/retention plus phone capture and acceptance tests. One writer per file; shared-interface changes go through root.

Phone code remains DOM/session/pipeline only. G2 -> mobile imports are the PR15 seam; mobile -> G2/SDK and mobile device writes remain forbidden. Evidence collection must not print session tokens, credentials, raw prompts or private artifact URLs.

## Loop protocol

1. Freeze criteria and record candidate/base, routes, package identity and initial failing evidence.
2. Reproduce a concrete failure offline or read-only. Assign the smallest correction with exact file ownership; do not bulk-port old fixes.
3. Run focused regression tests and applicable required build/suite checks. Inspect actual diff and evidence. A fixture/network shim/fake bridge must be labeled.
4. Root integrates independent changes and reruns affected combined checks only after relevant edits/failures. No automatic live retries.
5. When local gates pass, prepare the exact package and user device steps. User observations establish actual version/connection/Origin/capture/display. A missing device fact blocks its dependent row only.
6. Root consumes at most the two new real calls after prerequisites. Measure stop-to-visible results separately from backend latency. Verify shared History/reload on the same origin. Report pass/fail/block row by row.
7. Stop on accepted criteria or explicit bounds. Leave final diff, checks, unresolved steps and exact budget consumed. Do not publish/merge merely because local checks pass.

## Correction/evidence ledger

| Cycle | Trigger | Authorized correction | Evidence/result |
| --- | --- | --- | --- |
| Baseline | `/api/*`404 JSON through approved HTTPS host; relative package endpoints, missing session auth/network manifest | Root assigned aliases preserving auth/CORS; absolute host defaults, session-only token, exact whitelist/package identity, safe PCM diagnostics | Source inspection plus root-reported health 200 offline and three POST 404 responses. Physical Origin/version/build/pairing pending. |
| 1 | Root reproduced two ambiguous-repeat scoring cases returning `ok` instead of expected `uncertain` | Root ported narrow scoring 1.1.1 protection; owns analysis files | Root reports all 17 analysis tests pass after fix. Existing 8012 already used prior safety-fixed scorer; no new inference claim. Routing/auth/package work remains in progress. |
| 2 | Not started | Requires concrete failed acceptance | Not started. |
| 3 | Not started | Last bounded correction | Not started. |

Physical observations are pending. User reports the most updated Even Hub; exact version and candidate identity will be confirmed during reload. New budget is approved but not consumed by this documentation owner. Record future worker claims only after root checks artifacts; historical tests do not count as current checks.

## Handoff requirements

Final handoff states candidate commit plus uncommitted diff, exact package/hash, files changed, tests/builds actually run, actual physical observations, any fixture/fallback mode, provider call count and remaining budget, precise unresolved Origin/auth/device steps, and timing/allowance caveats. Do not claim physical completion while any required device row is blocked.

Root decision: an empty G2 take must be rejected before `SessionStore.stop()`; cancel it without a completed count and show an actionable capture error. Actual device disconnect remains unverified. Root also owns `scripts/device-runtime.mjs`; documentation owner only reviews its sanitized auth/Origin evidence.

Local checkpoint: loop engineer reports server 28/28 plus typecheck and capture 19/19 plus TypeScript checks. Root replaced only the owned 8799 process with candidate offline runtime after PID/cwd check, preserving token/Origin. HTTPS `/api/*` moved 404 ->401 unauthenticated, JSON throughout; health 200 remains offline. Actual package Origin and hardware route remain blocked. No new Gemini calls in this checkpoint.

Package handoff is authorized: user asked root to request that they load the local package for private testing. Agent upload/deployment/publication remains excluded; installation is pending user confirmation, not an authorization impossibility. Root production-dist CUA verified build identity/absolute endpoints/G2 source/session-token UI and unchanged count 0; hardware and actual Origin remain pending.

## Local freeze handoff

Writers froze the candidate. Loop engineer reports server 29/29 plus typecheck, mobile 165/165 plus build, G2 85/85 plus build, storage acceptance 5/5 and whitespace checks passed. Root reports analysis 17/17. One fixture correction aligned stale telemetry receipt hashes/metadata with strict upload validation; product assertions were retained. No repeated external blocker was retried and no live call was consumed by agents.

Synthetic local 8800 and exact-host HTTPS acceptance passed the shared normalized WAV -> duplicate-safe artifact -> real Basic Pitch 8/8 -> labeled fallback chain. The physical evidence matrix remains incomplete. The package is ready for the user's authorized private testing load; actual Origin, paired capture, displayed feedback, same-origin History/reload and real coach/timing evidence remain pending. Source/auth/diagram review found no additional blocking regression in reviewed seams. Read-only package hashing verified the candidate; embedded manifest extraction remains unverified by this reviewer.

Current output: build `c09807cd449f-20261018T081131Z`, 164,126-byte `g2/out.ehpk`, SHA-256 `e39bf73a908867952601e0d897e146383a19505bc1682409942233ada60f81ea`. No agent publication/deployment, Git shipping or new provider call is part of this handoff. Final allowance/time measurement remains root-owned; do not infer it from test counts.

## User device checkpoint

User evidence now confirms Even Hub 2.3.2, teammate-loaded candidate build `c09807cd449f-20261018T081131Z`, logs showing actual Origin `http://127.0.0.1:51684`, bridge ready and selection screen, and passage selection visibly displayed on paired physical G2. This is an initial display pass only; capture and later states are not inferred.

User approved the exact Origin replacement. Root restarted the owned offline backend 8799 with the same Funnel/token and model disabled. Root HTTPS probes: all three API preflights 204 with exact observed ACAO, old test Origin 403, unauthenticated physical-Origin POST 401. These probes do not establish physical upload. No package changed or reload is required. Cancel/capture actions remain pending; newly approved Gemini calls consumed 0/2.

Final full gate: `bash scripts/verify-storage.sh --include-g2` passed 313 tests (29 server, 165 mobile, 17 analysis, 4 duration, 8 Paper, 85 G2, 5 storage), required typechecks/builds, synchronization and boundary gates. Integration restored the packaged build ID in production dist after verification. Root owns subsequent device observations and real-call gating.
