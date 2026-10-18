# Reconcile PR18/19 with PR20

Status: source reconciliation accepted after independent review; final full-project gate and package identity are pending root completion. Root owns all Git operations and contract updates; loop engineer is the sole G2 source writer; this reviewer owns this report only. No provider call, installation, secret access or public-system change is part of this review.

## Verified branch facts

Read-only `gh pr view` and fetched Git refs established:

| Item | State/base/head |
| --- | --- |
| PR18 | OPEN, main <- g2/11-guide-keyboard, head `18ba013` |
| PR19 | MERGED, g2/10-phone-integration <- same g2/11-guide-keyboard; its sole feature commit is also `18ba013` |
| PR15 | Remote head `210c696`, merging PR19 into the older shared-host branch |
| PR20 | OPEN, main <- codex/g2-physical-verify; reported mergeable before this reconciliation |
| main | `a37e527`, now includes merged PR17 through `6cc6df5` |
| Starting local candidate | `cf541af`, clean before root's merges |

PR18/19 are one feature delta, not two separate implementations. Root merged current main and PR15 ancestry; resolving the overlapping G2 files must preserve PR20's shared pipeline and latest Review/replay rather than choosing either branch wholesale.

## Accepted mapping

Latest spec retains one G2 Review screen: tap replay, swipe cards, double tap Selection. No separate G2 Guide is restored. Phone Guide/Sheet stay intact.

| PR18/19 feature | Existing PR20 coverage | Smallest remaining integration |
| --- | --- | --- |
| Validated wrong-note keyboard, note names and expected/heard distinction | Latest wrong-note keyboard and replay already cover it with solid expected/cross heard styling | Retain current visual language; do not restore old hollow/filled marker conventions. |
| Keyboard context for missing/extra/timing/duration findings | Staff/timing/duration primary cards exist; keyboard context is not available for these cases | Add one optional, grounded keyboard context replay frame, before the existing final corrective frame. Keep latest static art and replay ending. |
| Expected/measured duration hold comparison | Current duration bars and written/heard replay already cover comparison | Retain bars; supplemental key/hold context preserves the association with the measured pitch. |
| G2 swipes update the shared finding | Current screen-local card index leaves phone state unchanged | Callback maps the new card's evidence IDs to `orderedFindings`, updates the shared index, and preserves the same attempt/count/history. |
| Paging closes phone sheet overlay | Currently omitted by G2 local paging | Batched closeSheet -> Review -> shared finding update; preserve history origin. |
| Stale queued images are dropped | Current generation and queue guards already cover this | Retain current guards for supplemental images and synchronized paging. |

Root accepted the two bounded implementation units: shared paging/Sheet synchronization and supplemental keyboard/hold context. Existing primary static/replay rendering is unchanged. The old Guide navigation and its duplicate results renderer are not reintroduced.

## Review constraints and regression targets

- Use exact deterministic visual evidence. Current `buildVisualPlan` suppresses clipped/dropout/unreliable/non-ok analysis into neutral cards; the supplemental keyboard must not invent a missing expected/played side or infer keys from unrelated context notes. Missing note: expected only. Extra note: heard only. Same-pitch duration: keep correct pitch and both measured hold values.
- Keep the latest solid expected / cross detected semantics and note labels. Old PR18 hollow expected versus filled played markers are a conflicting visual convention, not a feature to restore verbatim.
- Preserve latest static staff-written view, detected marks during replay, and end-on-fix. Insert context before the final existing corrective frame, not after it.
- Maximum staff reveal is four steps per phase: eight plus one context frame = nine. Existing `DOTS_ROOM` reserves `2 * MAX_REVEAL_STEPS + 1` = nine; assert the bound and correct progress counts.
- Translate card evidence using `orderedFindings`, not raw analysis order. Adopt resulting controller key under the batch guard so shared-store events do not recreate the Review screen, duplicate image work, or reset replay on every swipe.
- Normalize phone Sheet/Guide into Review for actual G2 paging, maintain History origin and edge bounds, and never increment counts or resubmit processing. Demo gallery must remain fixture-only and must not mutate a real attempt.
- Retain post-delivery dwell, failed-image caption guard, current-card/final-frame redraw and cancellation semantics from PR20.
- Focused tests cover missing/extra/sharp/duration geometry/evidence, no-key/neutral cases, same-ID/count History, raw-vs-priority finding order, Sheet closure, first/last page bounds, no rebuild on normal paging, and maximum replay frame count. Final full gate remains required.

## Evidence limits and bounds

At assignment, no new package, device, provider or latency verification was claimed. Earlier physical observations belong to the older loaded build and do not establish these source changes. Hardware gaps do not block the authorized source reconciliation; they remain explicit limits.

Loop bound: three correction cycles or 45 minutes of active work; the same external blocker twice stops dependent work. Account baseline is 69% of the 10,080-minute window, reset 1792881562; usage is account-wide. This reviewer only reads source/Git/PR state and edits this document.

## Independent source review

Reviewed the landed reconciliation against the previous candidate, including controller/store emissions, deterministic card evidence, replay sequencing and keyboard geometry. No material source defect was found in this pass.

- The shared callback maps the selected card to `orderedFindings`, closes Sheet, normalizes phone Guide to Review, and adopts the resulting key while controller synchronization is held. Current store subscribers only render UI or enable connection controls; they do not synchronously redirect state. The callback creates no recording and makes no processing call. Existing image/replay generation guards still cancel stale work.
- Supplemental context is available only for an analysis card with one finding ID of the matching supported kind. The card is rebuilt from deterministic evidence (or an exactly equivalent saved plan). `resolveMistakeVisualization` then requires the same saved attempt/passage/finding and matching coach-selected reference/detected IDs, reliable alignment and acceptable audio. Missing/extra notes retain only their valid side. Duration evidence requires finite positive tempo/holds and a measured duration delta within 5 ms of the stored claim.
- Hold bars normalize both values against their maximum, keeping their ratio within the image. The 96 px keyboard translated 24 px down fits the 144 px Review art slot. Expected pitch is solid; detected pitch is a cross, with separated marks for a shared pitch.
- Context precedes the first written corrective frame. Existing static rendering and the final corrective phase remain unchanged. Four played frames plus one context frame plus four written frames fit the nine reserved progress dots.
- The source diff leaves `mobile/src` unchanged, retaining phone Guide/Sheet and the shared capture/count/History pipeline. The gallery remains fixture-only; it does not receive the saved-attempt synchronization callback.

Final owner regression results, root's independent shipping checks and browser fixture evidence are recorded below. Browser/automated evidence does not establish hardware behavior.

Root's independent checks: `acceptance/shipping-reconciliation.test.mjs` passed 2/2. Browser rendering on local port 5202 showed the explicitly synthetic missing-note context with expected F4 only and a solid expected marker. The duration fixture showed same-key D4 solid/cross marks side by side and 2/1 hold bars at the expected 2:1 ratio, with labels inside the image and no observed clipping. These are raster fixture observations, not physical G2 evidence; the completed duration replay returned to the full written 2-beat correction, confirming that the supplemental context does not replace the final frame.


## Final disposition

Source accepted: no material unresolved concern in the frozen reconciliation. Loop engineer reports focused tests 54/54, full G2 tests 127/127, and production build passing. This reviewer inspected the actual source and relevant tests; these execution results are attributed to the owner. Root reports all conflict paths resolved and staged, with no remaining unmerged paths. Root's full-project verification is still running and will be recorded separately with the resulting package identity.

The independent navigation tests assert the same Review object and no page rebuild, closing Sheet/Guide into Review, ordered finding navigation, unchanged serialized History records, preserved historical origin/attempt/count, no capture actions, and edge bounds. New replay tests preserve the existing final frame, put exactly one supported context before the written phase, reject wrong-note duplication and neutral-audio replay, and compose with the existing reveal cap. Keyboard tests cover sharp placement, valid one-sided notes, same-key duration geometry, and actual solid/cross drawing primitives. Existing queue, cancellation, redraw, post-delivery dwell and fixture-gallery regressions remain in the G2 suite.

Accepted change units: (1) shared finding/Sheet synchronization without replacing the Review; (2) validated supplemental keyboard/hold context without replacing the latest resting artwork or final correction. Review correction cycles after submission: 0; normal development and test completion are not counted as review rework. No new hardware or provider proof is claimed, and no hardware gate blocks the authorized source PR update.

## Final upstream refresh

PR15 advanced during verification to `25e00a7` (main integration `24fa04c` plus PR19 ancestry). Astra compared the new source: the only missing user-visible improvement was readable processing-stage text and Demo provenance during processing. The coordinator preserved that mapping for initial and in-place updates; the independent shipping reconciliation suite passes 3/3 including all four labels and Demo behavior. The alternative independent phone/G2 paging remains intentionally superseded by synchronized finding selection. Gallery, neutral outcomes, latest primary artwork and replay were already covered.

## Verification correction

The first combined gate reached the shipping tests and failed the old duplicate-tap frame-count expectation: the newly authorized keyboard-context frame increased one replay by one frame. The worker left the locked acceptance file unchanged and reported the mismatch. The coordinator updated the verifier to require exactly one context frame, its saved finding ID, the unchanged final correction frame, and the original single-replay count plus one. No duplicate/stale assertion was removed. The corrected shipping suite passes 8/8; the complete gate is rerunning. This is one verification correction cycle after submission, not a product behavior failure.

The latest PR15 ancestry (`25e00a7`) is locally reconciled in `d540b2c`. The resulting source tree is identical to the reviewed `342e3ea` tree: its unique processing labels were already ported, and the alternative Gallery/Review adaptation is covered by the retained shared implementation. No GitHub PR was merged by this task.
