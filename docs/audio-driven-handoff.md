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

This session serves the worktree at `http://localhost:5216`, proxying `/api` to offline coaching on port 8826 and real Basic Pitch on port 8026. Use `localhost` because the backend allows that exact origin. The preview launcher is ignored `.run/start-preview.mjs`; standard repository startup remains documented in README.

No packages installed, credentials read, commits created, pushes or deployments performed. Existing Windows and WSL worktrees remain intact. Physical microphone quality, real phone browser lifecycle, G2 hardware/transport and live Gemini coaching were not verified in this run.

## Independent acceptance and coordination

Browser gate passed: controlled fake-microphone WAV produced 2-57 px waveform response and a measured 441 Hz tone in normalized uploaded audio. Recording-driven mocked responses persisted through History and reload without another analysis call. Permission denial and pending/active cancellation passed track/context cleanup checks. Coordinator visually inspected recording and result screenshots. Independent Sol integration review found no blocking defect. The conservative service-connection-unverified banner remains on saved results; no live health monitor was added.

Three acceptance units completed: demo/static audit and phone-only practice path; same-stream waveform and lifecycle; independent audio-driven browser/backend verification. Runtime corrections were completed before final gate acceptance. Browser verifier repairs and execution count are documented in AUDIO-LOOP.md. Existing regression tests were unchanged.

Measurement interval: 2026-10-18 09:19:31-09:28:48 UTC (9m17s; setup before baseline excluded). Account-wide Codex 10080-minute used percentage moved from 73% to 77%, with reset timestamp 1792881562 unchanged. Other concurrent work was observed; this +4 percentage-point change cannot be attributed solely to this task. No efficiency comparison claimed.
