# Audio and glasses feedback handoff

## Intended outcome

Report supported wrong and missing notes for audible piano that differs from the selected reference. Preserve first-note alignment and target-tempo timing feedback for recognizable phrases. Keep the authenticated backend usable when Even Hub changes loopback ports. Anchor wrong-note Xs to the written score on the glasses.

## Changes

- `analysis/scoring.py`: scoring 1.4.0-demo distinguishes equivalent pitch-alignment candidates from genuinely ambiguous takes, matches consistent tempo changes without erasing target-tempo errors, and adds a bounded rhythm-based fallback for wrong phrases. That fallback uses strong attack evidence and reports wrong/missing notes only; it withholds timing, duration and extra-note claims. Short fragments, weak evidence, capture faults and multiple complete takes remain gated.
- `analysis/service.py` and `analysis/audio_diagnostics.py`: health includes scoring version; ordinary logs contain redacted counts. An explicit debug directory under ignored `.run/` can retain one private numeric result and frequency summary. No waveform is retained by this diagnostic feature. It is disabled in ordinary service launches.
- `server/src/http.ts` and `scripts/device-runtime.mjs`: opt-in HTTP loopback origins across ports require a session token of at least 32 characters. Exact-origin restrictions remain the default; unrelated websites and missing/invalid tokens remain rejected.
- `g2/src/review/art.ts`: Review/replay keep the written bar visible and place a wrong-note X on the exact reference notehead. Guide shows the clean correction. Staff and ledger lines have stronger contrast; the heard pitch remains in the legend and keyboard detail.
- The Even Hub manifest and npm metadata are version 0.1.3. Earlier top-ten glasses prioritization and full phone History remain included.

## Verification

The full `bash scripts/verify-storage.sh --include-g2` gate passed 425 tests, typechecks and production builds. Existing build output includes a bundle-size warning. The ten-case direct Basic Pitch calibration check passed, including wrong pitches, tempo changes, noise-only input and silence.

`node acceptance/glasses-note-markers.browser.mjs` checks six rendered frames for marker/reference alignment, retained bar notes and clean Guide notation, then renders all 122 example static/replay frames. Raster output was visually inspected. The private phone browser check rendered returned correction data, verified all seven findings and preserved them after History reload.

Actual HTTPS checks verified successful upload, analysis and coaching with the existing private token; the current phone origin and two other loopback ports were accepted. Missing/invalid tokens and unrelated origins remained rejected. The package service origin and whitelist matched, its copied bytes matched the build checksum, and no session token was present in the client bundle. Numeric source-file and physical-capture comparisons reproduced the prior mismatch and confirmed that the new wrong-phrase path returns corrections. Private recordings, tokens, captures and logs stay outside Git.

## Release and runtime

Build 0.1.3 from the committed release source using `cd g2 && npm run pack -- https://timothylggram.tail51e140.ts.net`. The build sidecar records package version, commit, build ID and SHA-256. The package contains the phone/glasses client; Python scoring and origin/authentication changes run in the backend. The active analysis service uses scoring 1.4.0-demo. The authenticated device runtime keeps the existing session token and disables provider coaching during capture verification. The token must be entered in each newly opened client session.

## Remaining limits

No new physical-display verification was performed after the X-placement fix; browser/canvas checks cannot establish G2 rendering. Rhythmic comparison thresholds remain provisional. Without any pitch anchors, a missing opening note cannot be located uniquely, so the first strong played attack defines the entrance. Spectral peaks can be harmonics and are diagnostics, not a replacement piano classifier. Earlier saved results keep their original analysis; a new recording uses current scoring.

## Dense-analysis 502 follow-up

A physical take returned 132 detected events from the analyzer with HTTP 200. The coaching server still limited detected events to 128, rejected the valid result and emitted HTTP 502 before coaching. Server validation now matches the existing phone limits of 500 detections and 500 findings. Scoring guards oversized detector output before alignment and oversized findings before emitting a result; it returns bounded uncertainty rather than an invalid contract.

New regressions exercise upload → analysis → coaching for 132 and 500 events, rejection above 500, the existing phone acceptance boundary, and analyzer overflow. The authenticated device backend and analyzer were restarted with the existing token. Actual HTTPS upload/analysis/coaching checks returned 200; changing loopback ports remained accepted. The active device runtime has provider coaching disabled, so this failure was not Gemini quota exhaustion. A separate earlier 401 was observed at upload; latest successful coaching requests returned 200. The exact reported coaching-401 was not reproduced.

Dense-output verification completed: all 429 automated tests, typechecks and production builds passed. Evidence: `/tmp/encore-dense-full-verification.log`. The private failed-take result was accepted through both server coaching construction and the phone SessionStore validation. Live HTTPS upload, analysis and coaching returned 200. Package 0.1.3 remains compatible with this backend-only follow-up.
