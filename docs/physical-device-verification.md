# Physical G2 verification

Status: **NOT PHYSICALLY VERIFIED**. This fixed checklist covers the PR15 shared phone/G2 host. Source inspection, injected tests, browser fixtures, and earlier standalone-client results are separate evidence classes.

## Candidate and constraints

- Candidate: `/home/tim/projects/encore-device-verify`, branch `codex/g2-physical-verify`, starting at PR15 head `c09807c`.
- Preserved prior work: dirty `/home/tim/projects/encore-verify`. Its standalone client, old package/hash and old test totals are not this candidate. PR16 is reference only.
- Architecture: G2 owns bridge, microphone, gestures and display; its finished WAV enters shared PhoneCapture processing. SessionStore owns attempts and History. Mobile has no device side effects.
- Only approved service origin: `https://timothylggram.tail51e140.ts.net`. Preserve strict auth and exact Origin checks. No wildcard, additional host, new funnel or permission broadening.
- Earlier real Gemini budget was exhausted at 2/2. User has now approved **two additional calls**, same credential/project, only after local checks and physical capture succeed. Root owns the call guard. Workers and local acceptance remain offline. Do not spend these calls on fixtures or debugging retries.
- User reports the most updated Even Hub; exact installed version, pairing and candidate package are still pending the device reload step. No hardware pass follows from that statement.

## Fixed acceptance matrix

Every row requires candidate identity, timestamp, evidence source and pass/fail/block status. Preserve failed observations; never weaken an assertion to obtain a pass.

| ID | Requirement and evidence | Initial status |
| --- | --- | --- |
| P1 | Inspect actual EHPK digest, contents/entrypoint, exact single-origin whitelist and embedded minimum Even Hub >=2.2.10. User confirms installed version and this candidate package. | Blocked. Source manifest 2.0.0 and no network permission at baseline; no candidate package or installed-build evidence yet. |
| P2 | Actual package request URL, actual WebView Origin, JSON route, authorized preflight/POST, unrelated Origin rejected, missing/invalid auth rejected; no token in bundle/URL/log/storage. | Blocked. Root verified HTTPS health 200 in offline mode and POST `/api/recordings`, `/api/analyze`, `/api/coach` each 404 JSON. Backend exposes `/v1/*`; G2 has no proxy; phone defaults relative `/api/*` and has no bearer-session seam. |
| P3 | Explicit G2 source and physical mic capture. Record s16le/16kHz/mono assumption plus measured chunks/bytes/rate, source duration/frame count, clipping/peak/silence and disconnect behavior. | Blocked. Recorder logs chunks/rate but clipping and durable diagnostic correlation not established. |
| P4 | One canonical SessionStore attempt ID, completed count and artifact after stop plus duplicate-stop test; same passage/version/tempo and correlated capture diagnostics. | Unverified. Recorder currently creates a separate diagnostic ID before SessionStore starts. |
| P5 | Double tap and phone Cancel discard without completed save/count/upload. Long press/menu never starts/stops; duplicates suppressed; exit/disconnect turns mic off and interrupts without count. 30s cap stops once. | Hardware unverified. |
| P6 | Independent WAV decode confirms true 16kHz ->22,050Hz mono PCM16 resampling. Same hash/artifact/attempt/passage reaches real Basic Pitch then Strands/Gemini with matching validated analysis. | Blocked on physical capture/route/local gates; up to two newly authorized real calls remain root-controlled. |
| P7 | Physical Selection -> Ready -> Recording -> Processing -> Review/Guide; supported cue matches phone, readable pixels, swipe/back and Play again -> Library. During capture: static sheet/indicator or indicator only, no coaching or image transfer. | Physical display unverified. PR16 cards are not assumed present. |
| P8 | One `captureSource:g2` History record and count with same ID. Reopen makes no calls/capture/count change. Reload same package/origin preserves it; another origin/browser is explicitly a distinct local store. | Actual WebView persistence unverified. |
| P9 | Silence/clipping/noise/ambiguous repeats stay neutral. Mic-start, empty/odd PCM, network, stale/mismatched results, invalid coach, expired artifact,401/403/429 and duplicate retry preserve eligible attempt/count and stop terminal retries. | Local reproduction pending; injection must stay labeled. |
| P10 | Physical stop -> visible phone/G2 feedback, stage times and warm/cold conditions. Targets warm <=15s, cold <=30s; report sample count/source/provider. | Blocked. Old backend/synthetic timing is insufficient. |

## Ordered device procedure

1. Complete local package, route, session-auth and negative-origin checks. Record candidate/EHPK hashes and inspect embedded manifest/assets. Keep runtime token private and session-only. Root verifies the two-call guard before any provider request.
2. At reload, user confirms exact Even Hub version>=2.2.10, G2 pairing/connection and exact candidate package. Capture actual WebView Origin/request path before choosing the strict allowed Origin. Desktop HTTPS success is not device reachability.
3. Select P01, note total/per-passage counts, choose G2 microphone explicitly and compare previews. Exercise cancel, mic-start failure, duplicate and system-menu cases without provider calls. Toggle sheet only outside capture/processing.
4. Capture a physical take and stop once. Label laptop-speaker playback if used; do not call it a piano performance. Inspect sanitized PCM/WAV diagnostics and true resampling before enabling a real coach request. Silence/uncertainty bypass is honest but does not satisfy Strands/Gemini acceptance.
5. Root may use the newly approved bounded real calls only after local gates and successful physical capture. Preserve normalized hash, IDs, metadata and structured evidence; omit credentials/private audio URLs/prompts. Stop on exhausted budget or unexpected provider retry.
6. User observes glasses Review/Guide and matches phone feedback, uses gestures/Play again, reopens History and reloads the same package/origin. Confirm exactly one completed attempt. No device observation may be inferred from mocks.
7. Exercise failures offline/injected where possible. Stop dependent work on a repeated identical blocker; preserve symptoms and current counts. Do not consume remaining live calls to diagnose routing/auth/PCM failures.

## Integration decisions

Root approved this bounded implementation split: integration owns `g2/**`, mobile app/connection and their tests; loop engineer owns `server/**`, mobile capture/tests and acceptance; Astra documentation owner owns this file and `DEVICE-LOOP.md` only.

- Preserve PR15's shared pipeline. Do not copy old standalone upload/saving/feedback/normalizer wholesale.
- Implement server `/api/*` aliases without weakening existing `/v1/*` auth/CORS. Host supplies absolute approved-origin `/api/*` defaults and a session-only token seam.
- Adapt exact-origin manifest/pack generation for this host and inspect the produced EHPK. Old standalone package hash is not reusable evidence.
- Reproduce purged-attempt resurrection/terminal upload410 and ambiguous-repeat safety before selective port; port matching tests with any needed fix.
- Add G2-owned safe PCM diagnostics and canonical-ID correlation as needed. No mobile device side effects.
- Keep PR16 separate and preserve the earlier dirty worktree.

## Evidence log

Initial documentation-owner work: inspected candidate contract/spec/source and selected old dirty diffs. No tests, package extraction, hardware action, provider call, credential read or external mutation by this owner. Root separately reported current exact-host health 200 offline and three `/api/*` POST 404 JSON responses. Subsequent evidence must name its actual runner and candidate; do not import historical totals as new passes.

### Cycle 1 updates

- Root reproduced the two ambiguous-repeat regression cases on PR15 (`ok` instead of `uncertain`), applied narrow scoring 1.1.1 protection and reports 17 analysis tests passing. This is deterministic regression evidence, not physical audio or a new Basic Pitch inference. Existing analysis service 8012 already ran the prior safety-fixed scorer.
- Root decided empty G2 takes must cancel before `store.stop()` with an actionable capture error, yielding no completed count. Hardware disconnect remains unverified.
- In-progress auth design reviewed: host token lives in a closure, clears on pagehide, and endpoints are locked; backend aliases pass through existing strict CORS/auth. Final source/test/package review awaits writer freeze.

### Local route and auth checkpoint

Root reports server 28/28 plus typecheck and capture 19/19 plus TypeScript checks passed (loop engineer). After PID/cwd verification, root switched the existing owned offline backend 8799 to this candidate runtime, keeping the same token and allowed `http://localhost:5196` Origin. Public HTTPS health is200 offline; all three unauthenticated `/api/*` POSTs now return401 JSON instead of404. This establishes alias reachability and auth enforcement from the test client, not actual WebView Origin, authorized device requests or hardware connectivity.

Documentation-owner read-only source review found the bearer restricted to all three exact-origin expected paths with no query/hash/userinfo and `redirect:error`; origin changes revoke it. Token remains in the host closure and clears on pagehide. Backend aliases retain CORS/auth. Runtime uses `chooser:null`; safe observations exclude headers/body/query. G2 fallback now visibly says `local cue`, and Test WAV is labeled. Guide diagrams derive from grounded cards and send two tiles through the serialized glasses queue. Source review does not establish pixel fit, physical display, or device disconnect behavior.

### Local package checkpoint

Documentation owner independently hashed `g2/out.ehpk`: 164,126 bytes, SHA-256 `e39bf73a908867952601e0d897e146383a19505bc1682409942233ada60f81ea`; sidecar build `c09807cd449f-20261018T081131Z`. This identifies the inspected local output only. Its EHPK binary is not a ZIP and embedded manifest/assets have not yet been independently extracted by this owner. Source/generated-manifest correctness alone is insufficient for P1.

Installed EvenHub CLI README states EHPK is uploaded through the EvenHub site before opening it in the phone app; dev URL QR is a separate route. No upload/deployment was performed by this owner. The user explicitly requested a handoff asking them to load the package for private testing. Agent deployment/publication is not required or authorized. P1 is pending the user's upload/import and confirmation of this exact candidate; do not request duplicate permission. Root must distinguish a dev-host test from this package test.

### Production browser checkpoint

Root reports CUA inspection of production dist on 5198: displayed build ID, all three exact HTTPS `/api/*` endpoints, G2 microphone source option and session-token field. Selecting G2 retained count 0 and honestly reported unverified hardware. Standard-browser bridge failure is expected without Even hardware; this is UI/configuration evidence only. Full suite and actual device diagnostics/Origin remain pending. Root will hand off the local EHPK for the user's explicitly requested private testing load, then request exact CORS configuration approval once the actual device Origin is known.

## Final local checkpoint before user device load

Loop engineer reports the frozen combined source passed server 29/29 tests plus typecheck, mobile 165/165 plus build, G2 85/85 plus build, storage HTTP acceptance 5/5, and `git diff --check`. Root separately reports 17/17 analysis regressions passed. These counts are current automated checks; they do not establish hardware acceptance. The telemetry test fixture initially failed 13 cases because its old upload stub supplied fake hashes/metadata; the fixture now echoes the real normalized WAV hash/metadata and the full mobile suite passed. Acceptance assertions were preserved.

The loop engineer ran `acceptance/device-http.mjs` against local port 8800 and the approved HTTPS origin. Each run used synthetic 16 kHz PCM, actual normalization to a 441,044-byte 22,050 Hz WAV, duplicate upload returning the same artifact, real Basic Pitch on 8012 matching 8/8 notes, and explicitly labeled fallback coaching. SHA-256: `5aaee834f3e5d9aae214ae742f338a4340316ba08c1d25502d585dc52e82500f`. Upload / duplicate / analysis / coach timings were 62 / 17 / 389 / 6 ms locally and 129 / 34 / 420 / 7 ms over HTTPS. These are synthetic HTTP stage samples, not physical stop-to-visible-feedback timings; no Gemini calls occurred. The harness uses the authorized private token in-process without printing it.

Documentation owner independently confirmed the EHPK hash listed above and checked that inspected production source modification times precede package creation. Root/integration own packaging and production browser evidence; embedded EHPK extraction is still unverified by this owner. Read-only auth review found exact-origin/path token scoping, redirects refused with a token, revocation on origin change, memory-only session credentials, unchanged strict backend CORS/auth, and no provider in the offline runtime. Evidence-bound G2 diagrams and explicit fallback/Test WAV labels are present in the source. No additional blocking regression was found in those reviewed seams.

| Gate group | Current disposition |
| --- | --- |
| P1 package | Local package and hash ready; embedded manifest extraction and actual installed candidate/version pending. |
| P2 route/auth | Local and approved HTTPS synthetic path/auth verified; actual WebView Origin and device CORS approval pending. |
| P3-P5 physical capture/gestures | Local capture/ID/empty-take/gesture regressions passed within the reported G2 suite; actual PCM, clipping, gestures, disconnect and count observations pending. |
| P6 model chain | Synthetic same-WAV Basic Pitch + fallback route passed. Physical audio and the two newly approved real Strands/Gemini calls remain pending root's prerequisite gate. |
| P7-P8 display/History | Source, injected tests and production-browser controls checked; physical Review/Guide, same-origin WebView reload and one History record pending. |
| P9 errors | Current automated regressions passed; hardware-specific errors remain unverified. |
| P10 latency | HTTP stage samples recorded; no physical warm/cold stop-to-visible result measurement. |

Next dependent action is the user's already-authorized private testing load of the identified package and report of build ID, exact Even Hub version, pairing, displayed WebView Origin and a physical G2 capture. Root can then resolve exact CORS configuration approval and enforce the remaining two-call budget. No additional permission is implied for merely preparing or handing off the package.

## Physical device checkpoint: package open and selection visible

The user reports Even Hub **2.3.2**. Their teammate loaded build `c09807cd449f-20261018T081131Z`; supplied logs show actual WebView Origin `http://127.0.0.1:51684`, bridge ready and selection screen. The user explicitly confirms that passage selection is visible on the paired physical G2. This establishes the installed build/version and initial physical display observation, not microphone, processing, Review/Guide or History acceptance. Embedded package extraction remains a separate unverified local artifact check.

The user explicitly approved replacing the previous test Origin with the observed exact Origin. Root updated the runtime validator to permit the literal HTTP 127.0.0.1 Origin and restarted the owned offline backend 8799 with `chooser:null`, the same Funnel and session token. Root's HTTPS probes then showed OPTIONS to all three `/api/*` routes returning 204 with `Access-Control-Allow-Origin: http://127.0.0.1:51684`; the previous `http://localhost:5196` Origin returned 403, and an unauthenticated POST carrying the physical Origin returned 401. These are root network probes using the observed Origin, not a physical-device upload. No wildcard or additional Origin was allowed.

No package changed and no reload is required for this server-only CORS update. First cancel/capture actions are pending. New Gemini budget consumption remains **0/2**; offline backend cannot make a provider call.

The final combined command `bash scripts/verify-storage.sh --include-g2` passed exit 0: server 29, mobile 165, analysis 17, duration 4, Paper 8, G2 85 and storage 5, totaling 313 automated tests. Required typechecks, mobile/G2 builds, passage synchronization and boundary gates passed. Loop engineer reports integration restored packaged production dist with the same build ID after the verification build. These automated results remain separate from physical observations.

Current physical progress: P1 installed build/version observed (embedded extraction pending); P2 actual Origin identified and strict CORS probes passed (authorized physical request pending); P7 initial Selection display observed only. P3-P6 capture/gestures/model chain, P7 Review/Guide, P8 History/reload, physical P9 failures and P10 latency remain pending.
