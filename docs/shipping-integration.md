# Shared-session review/replay integration

**Review result:** no material unresolved source regression found in the inspected reconciliation. The branch is suitable for the user's authorized review-branch commit/push after the coordinator's final combined gate. This does not authorize a GitHub merge or deployment and does not claim physical replay verification.

## Included ancestry and architecture

PR15 `c09807c` provides the shared host/pipeline. Its merge-base with main is `adf3bdb`; main's apparent removal of PR15 files was branch divergence, not an instruction to discard them. Root preserved the local device/pipeline fixes in logical commits, integrated main `6f4124a` (PR16 `cbf0b84` plus spec `971ddac`), and explicitly included PR17 through `6cc6df5`. Local merge checkpoint: `f2751d8`. PR17's bounded follow-ups add replay, detected cross marks, ordered note reveal, end-on-fix, and static staff written-layer rendering.

The retained runtime is:

```text
g2 host/bridge/gestures/microphone/display
  -> mobile app + one SessionStore
  -> shared PhoneCapture normalization/upload/analysis/coaching/retry
  -> shared History and phone-only DOM
```

The controller adapts the saved attempt's deterministically grounded visual plan into G2 cards. It does not restore main's standalone multipart upload or create another attempt/history pipeline. Mobile does not import the SDK/G2 or write to the device.

## Feature-preserving resolutions

| Feature | Final disposition |
| --- | --- |
| Canonical capture ID, PCM/chunk/clipping diagnostics, empty/odd capture rejection, cancel/count rules | Retained in G2Capture/Recorder and shared SessionStore. |
| Same normalized WAV/hash, upload validation, retention/retry safety and uncertain-repeat scoring | Retained in shared capture/backend/analysis. |
| Exact-origin package/service configuration and session-only token | Retained; existing auth/CORS remain strict. |
| Phone Library, Results, Guide/Sheet, History and settings | Phone renderer/session/feedback unchanged by G2 reconciliation. |
| G2 selection, ready/static sheet, recording/discard and system sheet menu | Retained. |
| G2 corrective information | Grounded visual Review cards/replay replace duplicate Guide/results/feedback-visual implementation; authored finger guidance appears when it fits. |
| G2 navigation | Latest spec governs: tap replay, swipe cards, double tap Selection. Phone Guide/Sheet remain available. |
| Latest PR17 artwork | Ordered reveals, one-second intermediate/two-second phase-end holds, ending on the fix; static staff shows written passage, detected cross marks appear in replay; keys/timing retain detected marks at rest. |
| Neutral results and provenance | No-coach uncertain/insufficient audio produces neutral microphone cards. Demo, Test WAV and local-cue labels remain visible. |
| Explicit DEV gallery | `?demo=review` is reachable through shared host/controller, labeled DEMO, returns to Library, creates no attempt and makes no processing call. |

The old tap-to-Library and swipe-to-G2-Guide gestures conflict with the newer merged spec. Their underlying correction information is retained in cards/replay; preserving both gesture meanings simultaneously would be contradictory.

## Findings resolved and reviewed

1. **Visible replay dwell:** previously started before render/BLE transfer. It now starts after confirmed image delivery and caption updates; a delayed-image regression covers the visible hold. Failed/stale image delivery does not advance the caption.
2. **Menu redraw consistency:** page rendering uses the current card and retains the delivered correction frame. Regressions cover card-two redraw and redraw after replay ends on the fix.
3. **Neutral no-coach outcome:** adapter handles uncertain/insufficient audio before requiring coaching. Both normal outcomes have focused microphone-card regressions.
4. **Phone/glasses evidence order:** controller translates phone findingIndex through the same `orderedFindings` helper. A test deliberately has raw findings in a different order from displayed priority cards.
5. **Grounding:** exact deterministic visual resolution replaces shape-only trust. A forged attached fixture plan cannot replace saved-attempt evidence; exact analysis note IDs select highlights and authored fingers.
6. **Gallery retention:** the initial merge kept gallery fixtures but lost their runtime entry point. The explicit DEV route is restored with a no-attempt/return-to-Library regression.

Reviewer inspected these changes and tests after the G2 owner's freeze. Duplicate replay suppression, swipe cancellation, generation-guarded queued updates and controller disposal remain covered. Only obsolete duplicate G2 renderer files were removed; phone Guide/Sheet remain unchanged. No additional source edit was made by this reviewer.

## Verification evidence and scope

- G2 owner reports **116/116 tests passed** and a production build using temporary output passed. Reviewer inspected actual regression source and current diff; unchanged tests were not redundantly rerun by this reviewer.
- Reviewer ran `git diff --check`; passed. Coordinator/loop own the final combined gate and browser raster inspection; their final result should be recorded in `SHIP-LOOP.md` before shipping.
- Root's current-source HTTP smoke against isolated loopback 8801 and existing real Basic Pitch 8012 passed the offline health guard (`modelConfigured:false`). Synthetic 16 kHz G2-like PCM became a 441,044-byte 22,050 Hz WAV, analysis matched 8 notes, fallback coaching returned and duplicate upload reused the same artifact. Attempt `acd005ec-7975-49f8-844c-69020b48ad63`; upload/duplicate/analysis/coach 23/18/504/6 ms. This is synthetic HTTP/Basic Pitch evidence, not browser microphone, hardware, Gemini or end-to-end latency.

Safe reproduction only after authorization to read the existing private session-token file:

```sh
cd /home/tim/projects/encore-device-verify/server
node --import tsx ../acceptance/device-http.mjs http://127.0.0.1:8801 "$ENCORE_AUTHORIZED_TOKEN_PATH"
```

The environment variable names the approved private token file, not its contents. Preserve the offline health guard and never print credentials. Root's actual run used the authorized private path without exposing its contents.

## Physical and shipping limits

Earlier user observations establish Even Hub 2.3.2, loaded build `c09807cd449f-20261018T081131Z`, Origin `http://127.0.0.1:51684`, paired G2 passage selection and reported recording/cancel behavior. They do not prove this reconciled replay package. Physical PCM diagnostics, real coach output, Review replay timing/readability, History/reload and full latency remain unverified.

Incomplete physical validation is a documented limitation, not a blocker for the requested review-branch push. Root owns final branch/SHA, remote verification and PR artifact. This reviewer performed no Git writes, secret reads, installs, provider calls, publication or deployment. Public Funnel/runtime were not changed by this review. New Gemini budget remains unused at 0/2. Shipping-phase allowance baseline is root-reported 63%, account-wide; no per-worker cost inference is justified.
