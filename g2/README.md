# Encore · G2 glasses app

Glasses side of Encore (see `../spec.md`). Vite + TypeScript + Even Hub SDK, built screen by screen from the Paper mockups.

## Run

```bash
npm run dev
```

Then either:
- **Simulator:** `npm run simulate`
- **Real glasses:** `./node_modules/.bin/evenhub qr --url http://<your-ip>:5173` and scan with the Even Hub companion app.

## Tests

```bash
npm test
```

Node's built-in test runner on the TypeScript sources (no extra dependencies; relative imports carry `.ts` so Node can resolve them). `tests/fakes.mjs` stands in for the Even bridge, so screens, input, recording, the G2 capture source, the phone↔glasses controller and the glasses queue run without hardware. Staff drawing is covered through `staffLayout()`, the canvas-free layout step.

For a presentation-only fixture gallery in the simulator, open the dev URL with `?demo=review`. It shows all prepared Review cards with a visible DEMO label; double tap returns to the shared Library. It creates no recording and makes no backend or model request. For browser-only raster inspection without an Even bridge, open `/tests/review-browser.html` from the Vite dev server. That fixture displays the same card art and correction replay, without exercising the glasses transport. Its Show key context button previews explicitly synthetic keyboard and hold-duration context.

`/tests/segments-browser.html` displays paired Review and Guide pages from a synthetic v2 saved result. Both pages use the same one-bar notation window and bar/beat position. This is a browser approximation of firmware text and canvas art, not evidence of physical glasses behavior. Unit tests also cover complete forward/reverse pair navigation, read-only History, interval clipping, unlocated events, and cancellation of late Guide replay work.

## Phone and glasses together

This page hosts the phone UI from `../mobile/` (`startPhoneApp`) and mirrors its session on the glasses; see [`../glasses-integration/CONTRACT.md`](../glasses-integration/CONTRACT.md). The phone's `SessionStore` is the only source of truth: phone buttons and glasses gestures make the same session calls, and `src/controller.ts` redraws the glasses from it.

To record from the glasses, open **Connection settings** on the hosted phone page and choose **G2 microphone**. This package fixes all three API endpoints to `https://timothylggram.tail51e140.ts.net/api/...`; enter the service bearer token in the password field for this WebView session. The token is never persisted, logged, or bundled. The standalone `mobile/` build retains its own relative `/api/...` defaults. Each take, with captured PCM wrapped as a 16 kHz WAV under the SDK format assumption, goes through the phone's own pipeline (`PhoneCapture.processRecording`): normalized to 22.05 kHz mono, uploaded once with `captureSource: "g2"`, then analyzed and coached, with the same retry window and History as phone recordings. See `../PIPELINE-HANDOFF.md` for running the services. The generated package manifest whitelists only that HTTPS origin. Actual Even WebView `Origin` and CORS behavior still require a physical run; the debug panel shows the observed `location.origin` without logging credentials. Practice always uses captured audio. The separate development Review gallery described above needs no services and is visibly labeled DEMO; it does not create attempts.

Glasses diagnostics are in the collapsed **Glasses debug** panel under the phone UI; it opens by itself on any error.

## Legacy upload utility

`src/upload.ts` is retained from the teammate branch for compatibility, but the current host does not import it. Its standalone multipart upload and saved Upload URL are not part of this package's user flow. Active G2 takes use the authenticated shared `PhoneCapture` pipeline described above, with one attempt and one History record. Do not wire the legacy utility alongside that pipeline.

## Pack for distribution

```bash
npm run pack -- https://timothylggram.tail51e140.ts.net
```

The pack script validates the approved exact origin, generates ignored `app.network.json`, builds with the same origin and visible build ID, and invokes only the installed local Even CLI. It writes `out.ehpk` and ignored `package-build.json` containing the package SHA-256 and build ID. The manifest requires Even Hub app 2.2.10. Packaging does not install or deploy anything.

## What's in here

| File | Purpose |
|---|---|
| `src/main.ts` | Mounts the phone UI, boots the bridge, routes normalized input to the controller. |
| `src/controller.ts` | Phone session state → glasses screen; glasses gestures → session calls (CONTRACT.md state map). |
| `src/g2capture.ts` | The G2 mic as the phone session's capture source: mic on, one `g2` attempt, WAV → analysis → coaching; discard, interrupt, 30s cap. |
| `src/feedback.ts` | Derives every saved finding/bar pair in shared priority order, beyond the top-three overview; clips notation to the validated bar, labels source and local cues. |
| `src/review/` | Evidence-bound card text, authored reference finger cues, keyboard/staff/rhythm art, and timed correction replay. |
| `src/glasses.ts` | Serialized, time-limited bridge calls; startup page vs. rebuild. |
| `src/input.ts` | Maps SDK events to `tap` / `doubleTap` / `swipeUp` / `swipeDown` / `listSelect` / `menuItem`; drops duplicates and any tap that belongs to a long press. |
| `src/settings.ts` | Display settings (spec §5), saved in Even app storage, and the sheet-music system-menu item. |
| `src/layout.ts` | Shared geometry from the Paper mockups; right-aligned text via `@evenrealities/pretext`. |
| `../shared/passages.ts` | The six approved seed passages and authored fingerings (spec §7), shared with the phone Guide. |
| `src/passages.ts` | Re-exports the shared passages for G2 screens. |
| `src/recorder.ts` / `src/wav.ts` | One mic capture at a time; G2 PCM (s16le, 16 kHz, mono) wrapped as WAV, with the measured byte rate logged. |
| `src/staff.ts` | Draws a passage on a treble staff and splits it into two 288×112 PNG tiles. |
| `public/fonts/` | One-glyph Noto Music subset for the treble clef (SIL OFL, see `OFL.txt`). |
| `src/screens/` | One file per glasses state (spec §4). |

## Screens

| Mockup | State | Status |
|---|---|---|
| 01 | Selection | Native list (5 rows), tap to open, double tap to exit; no hints. Shown while the phone is on Library or History |
| 02 | Ready | Staff (2 image tiles), focus line, dimmed `tap ●` hint, double tap back |
| 03 | Recording | Tap ● (or Start on the phone) starts the session's source. Sheet music on: text swapped in place, staff stays (no image sends); off: just ■. `tap ■` stops and analyzes, `2× discard` throws the take away and returns to Ready |
| 04 | Analyzing | Short status; no input, no menu |
| 05 | Review → Guide | Every finding/bar pair has Review then Guide. Down advances and up reverses the shared sequence without wrapping; Review tap opens the same pair's Guide, Guide tap replays its correction, double tap → Selection. Both pages show the same validated bar window and position; Review compares expected/heard notes, Guide starts on the written correction with its grounded cue and authored reference finger when supported. Phone navigation stays synchronized; a phone sheet overlay keeps the underlying G2 Review/Guide page, and glasses navigation closes that overlay. Reopened History uses the same read-only pages with a Saved label. Legacy v1 results retain meaningful beat cards without invented bar positions; v2 unlocated findings are text-only. Uncertain audio gets a neutral microphone card without replay. |
| — | Recoverable error | Plain reason (never a musical claim); tap → Selection |
| — | System menu | Tap then hold: "Hide/Show sheet music" item (no Settings screen); omitted while recording/analyzing |
