# Audio-driven acceptance loop

The independent browser gate is `acceptance/audio-driven.browser.mjs`. Run it from the repository root with existing Node 22, Playwright, and Chrome:

```bash
node acceptance/audio-driven.browser.mjs
```

The script starts Vite on a free local port and stops it afterward. It generates an eight-second 48 kHz WAV with silence, quiet A4, and loud A4 phases, then feeds it through Chromium's fake microphone device. This exercises `getUserMedia`, MediaRecorder, the live DOM waveform, browser WAV normalization, upload, result rendering, IndexedDB history, and reload. The test service inspects the *exact normalized PCM16 WAV bytes uploaded by the app*: its RIFF header, sample rate, length, RMS range, and measured A4 frequency. It hashes those bytes for the upload receipt, then returns analysis and coaching tied to that attempt and observed pitch. The browser checks that silence flattens the visible bars, louder input raises them, a finding and measured result appear, and reload reads saved history without service calls. It also checks denied permission, cancellation while permission is pending, active cancellation, microphone track stops, and Web Audio context closure.

This is browser-mediated synthetic input, not proof of physical microphone or live piano performance. The mock analysis is conditional on the recorded WAV. It does not assert Basic Pitch correctness. The separate real local HTTP pipeline check runs three synthetic WAVs through Basic Pitch and key-free coaching:

```bash
PYTHONPATH=. analysis/.venv/bin/python acceptance/recorded-audio-pipeline.py
```

That pipeline needs the local analysis and coaching servers described in `docs/audio-driven-handoff.md`; its log is `.run/recorded-audio-pipeline.log`. It verified reference 8/8 matching, changed-pitch wrong-note detection, and silence returning insufficient audio with no findings. The browser gate does not need those servers or provider credentials.

The loop was bounded to four correction iterations or 35 minutes. The same unresolved failure appearing twice would stop the loop. Success required the final frozen verifier and project gates to pass. There were four browser executions: an initial verifier navigation error, a pass after correcting navigation, an expanded active-cancellation check with an incorrect History expectation, and a final pass. These required two verifier corrections and no product-code correction. No identical unresolved failure recurred.

The browser assertions were first frozen before implementation correction at SHA-256 `2759f9822518c05265d04235b10d94a1dc0565abd5d75e5ba2c8d0a71b3feffd`. The first run reached waveform, upload, result, history, and reload, then exposed a verifier navigation error: pending microphone cancellation returns to the passage preview, which has no History button. The verifier was amended to return to Library first, and screenshots plus explicit resource checks were added. The active-cancellation extension's initial empty-History expectation was corrected to the app's documented behavior: a canceled attempt remains labeled in History but counts as zero completed recordings. Neither error required a product-code change. The final verifier SHA-256 is `a4ff2ee4dfa6e36f99f77a5c70cc8a00c403c73b87d47e73cf69f41dba9b003f`.

Final browser result: pass. One run measured a 2–57 px waveform range, a 441 Hz tone in a 537,182-byte uploaded WAV, one stopped track after pending cancellation, and one stopped track plus a closed metering context after active cancellation. A completed recording closed both its metering and decoding contexts. Representative screenshots are `.run/recording-waveform.png` and `.run/recorded-result.png`. These files are ignored local review artifacts.

The repository gate was also run by the coordinator: 26 server tests and typecheck, 14 Python analysis tests, 4 duration acceptance tests, 8 Paper contract tests, five storage-server acceptance tests, and the full mobile suite plus build. Final mobile coverage was 162 passing tests, including five focused meter tests. The G2 diff is empty. Real phone/browser microphone behavior, physical acoustics, G2 hardware, and live Gemini coaching remain unverified.
