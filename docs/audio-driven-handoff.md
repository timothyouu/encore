# Audio-driven phone practice

Branch: `codex/audio-driven-app`, based on `a37e527`. Worktree: `/home/tim/projects/encore-audio-driven`.

## Outcome and scope

Practice uses the phone microphone or an explicitly labeled imported test WAV. Removed the simulated practice driver and scenario picker. A Web Audio analyser reads the same stream as MediaRecorder; 40 level bars reflect signal amplitude, silence is flat, and unavailable metering is labeled. The analyser never connects to speakers. Stop, cancel, disconnect, failure and disposal release resources. Authored songs, reference notation and finger suggestions remain static. Historical demo records remain labeled as demo.

Phone settings now describe the phone reference score, and the preview no longer claims reference audio playback. Analysis, coaching and History already used uploaded recording evidence and were retained. The separate visualization study gallery remains explicitly labeled fixture content; it does not feed practice results. Glasses runtime and transport were not changed.

## Changed files

- `mobile/src/audio-meter.ts`: measured amplitude and Web Audio lifecycle.
- `mobile/src/capture.ts`: same-stream meter setup and cleanup.
- `mobile/src/phone.ts`, `phone.css`: live waveform and accurate practice/settings copy.
- `mobile/src/main.ts`, `connection.ts`: microphone-only practice wiring, no fixture driver.
- `mobile/tests/audio-meter.test.mjs`: silence/amplitude, supplied stream, initialization and disposal failure cases.
- `acceptance/audio-driven.browser.mjs`: independent browser verification.
- `acceptance/recorded-audio-pipeline.py`: real Basic Pitch differentiation of reference, wrong-note and silent WAVs.
- `mobile/README.md`: updated behavior and actual retry persistence.

## Verification

The baseline repository gate passed: 26 server tests and strict typecheck, 14 Python analysis tests, 4 duration acceptance tests, 8 Paper contract tests, passage synchronization, and unchanged G2 ownership boundary. Five storage-server acceptance tests also passed. After runtime edits, all 161 mobile tests and strict production build passed; the final test-only addition passed the focused meter suite (5/5), for 162 mobile cases covered. No existing test expectations were weakened.

Three real local HTTP pipeline cases passed using synthetic WAVs and Basic Pitch: reference notes matched 8/8; changing one pitch changed detected pitches and generated a wrong-note finding; silence returned insufficient_audio and no findings. Upload hashes matched input bytes and offline coaching referenced the same attempt/evidence. This used no provider calls or secrets. Logs are in ignored `.run/`.

Independent browser outcome and bounded-loop details: see `AUDIO-LOOP.md`.

## Local preview and limits

This session serves the worktree at `http://localhost:5216`, proxying `/api` to offline coaching on port 8830 and real Basic Pitch on port 8030. Use `localhost` because the backend allows that exact origin. The preview launcher is ignored `.run/start-preview.mjs`; standard repository startup remains documented in README.

No packages installed, credentials read, commits created, pushes or deployments performed. Existing Windows and WSL worktrees remain intact. Physical microphone quality, real phone browser lifecycle, G2 hardware/transport and live Gemini coaching were not verified in this run.

## Independent acceptance and coordination

Browser gate passed: controlled fake-microphone WAV produced 2-57 px waveform response and a measured 441 Hz tone in normalized uploaded audio. Recording-driven mocked responses persisted through History and reload without another analysis call. Permission denial and pending/active cancellation passed track/context cleanup checks. Coordinator visually inspected recording and result screenshots. Independent Sol integration review found no blocking defect. The conservative service-connection-unverified banner remains on saved results; no live health monitor was added.

Three acceptance units completed: demo/static audit and phone-only practice path; same-stream waveform and lifecycle; independent audio-driven browser/backend verification. Runtime corrections were completed before final gate acceptance. Browser verifier repairs and execution count are documented in AUDIO-LOOP.md. Existing regression tests were unchanged.

Measurement interval: 2026-10-18 09:19:31-09:28:48 UTC (9m17s; setup before baseline excluded). Account-wide Codex 10080-minute used percentage moved from 73% to 77%, with reset timestamp 1792881562 unchanged. Other concurrent work was observed; this +4 percentage-point change cannot be attributed solely to this task. No efficiency comparison claimed.

## PR22 reconciliation with shared phone/G2 integration

Merged upstream `fb03946` into this branch, preserving the thin standalone bootstrap and shared `startPhoneApp` architecture. The phone/G2 source picker remains when a host supplies G2 capture; simulated practice is removed from the shared app. Both sources retain one SessionStore, processing pipeline, protected service-origin/session-token handling, and History. The phone waveform is supplied through app actions only for the phone microphone. Host device status and shared feedback helpers remain intact. The only G2 runtime difference from upstream is corrected status text for an unconfigured service; capture, transport, Review and replay logic are unchanged.

Independent review reproduced an existing G2 cancel/restart race in unchanged upstream Recorder/G2Capture: canceling a pending mic start and immediately restarting can let the old take turn off the new take's mic and drop its frames. The diagnostic is ignored `.run/repro-recorder-race.mjs`. This predates PR22 and is recorded as a separate follow-up, not a regression introduced by this merge. Physical device behavior remains unverified.

Reconciled browser checks passed: the original phone waveform/recording/result/History/reload/cancellation gate, plus an independent host-source smoke of the actual shared app. The host smoke selected G2 through the UI, started/stopped a fake host capture, submitted normalized WAV through the shared pipeline with one completed G2 attempt, asserted no phone waveform or phone microphone request, checked session authorization only to approved HTTPS routes, and switched back to phone where Start invoked getUserMedia. Its first execution had an ambiguous test selector; the corrected selector passed. This is simulated host input, not physical G2 validation.

Final reconciled repository gate passed with exit 0: 29 server, 170 mobile, 17 Python analysis, 4 duration, 8 Paper, 127 G2, 8 shared-integration, and 5 storage-server tests (368 total); server typecheck and both mobile/G2 production builds passed. Both browser gates and the three real audio-analysis cases passed. PR diff whitespace is clean. The existing G2 lifecycle race above is the sole separately identified upstream follow-up.
