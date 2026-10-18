# Encore · G2 glasses app

Glasses side of Encore (see `../spec.md`). Vite + TypeScript + Even Hub SDK, built screen by screen from the Paper mockups.

## Run

```bash
npm install
npm run dev
```

Then either:
- **Simulator:** `npm run simulate`
- **Real glasses:** `npx evenhub qr --url http://<your-ip>:5173` and scan with the Even Hub companion app.

## Tests

```bash
npm test
```

Node's built-in test runner on the TypeScript sources (no extra dependencies; relative imports carry `.ts` so Node can resolve them). `tests/fakes.mjs` stands in for the Even bridge, so screens, input, recording, the G2 capture source, the phone↔glasses controller and the glasses queue run without hardware. Staff drawing is covered through `staffLayout()`, the canvas-free layout step.

## Phone and glasses together

This page hosts the phone UI from `../mobile/` (`startPhoneApp`) and mirrors its session on the glasses; see [`../glasses-integration/CONTRACT.md`](../glasses-integration/CONTRACT.md). The phone's `SessionStore` is the only source of truth: phone buttons and glasses gestures make the same session calls, and `src/controller.ts` redraws the glasses from it.

To record from the glasses, open **Connection settings** on the phone and choose **G2 microphone** (the upload, analysis and coaching endpoints default to the local `/api/...` services). Each take, as G2's actual 16 kHz WAV, goes through the phone's own pipeline (`PhoneCapture.processRecording`): normalized to 22.05 kHz mono, uploaded once with `captureSource: "g2"`, then analyzed and coached, with the same retry window and History as phone recordings. See `../PIPELINE-HANDOFF.md` for running the services. Remote services need CORS for the WebView's origin and their domains in `app.json` under a `network` permission. **Demo** needs no services and labels its results Demo on both screens.

Glasses diagnostics are in the collapsed **Glasses debug** panel under the phone UI; it opens by itself on any error.

## Uploads

Set the **Upload URL** on the phone screen (saved in Even app storage). Each take is POSTed as `multipart/form-data`: `audio` (WAV) and `metadata` (JSON: attempt ID, passage ID/version, timestamps, format, duration, measured byte rate, `captureSource: "g2"`). The server must send CORS headers, and the packaged app needs its domain in `app.json` under a `network` permission. For simulator testing, `VITE_ENCORE_UPLOAD_URL=<url> npm run dev` presets the URL when none is saved.

## Pack for distribution

```bash
npm run pack
```

Produces an `.ehpk` file.

## What's in here

| File | Purpose |
|---|---|
| `src/main.ts` | Mounts the phone UI, boots the bridge, routes normalized input to the controller. |
| `src/controller.ts` | Phone session state → glasses screen; glasses gestures → session calls (CONTRACT.md state map). |
| `src/g2capture.ts` | The G2 mic as the phone session's capture source: mic on, one `g2` attempt, WAV → analysis → coaching; discard, interrupt, 30s cap. |
| `src/feedback.ts` | Glasses wording for a result, from the phone's shared finding helpers. |
| `src/glasses.ts` | Serialized, time-limited bridge calls; startup page vs. rebuild. |
| `src/input.ts` | Maps SDK events to `tap` / `doubleTap` / `swipeUp` / `swipeDown` / `listSelect` / `menuItem`; drops duplicates and any tap that belongs to a long press. |
| `src/settings.ts` | Display settings (spec §5), saved in Even app storage, and the sheet-music system-menu item. |
| `src/layout.ts` | Shared geometry from the Paper mockups; right-aligned text via `@evenrealities/pretext`. |
| `../shared/passages.ts` | The six approved seed passages and authored fingerings (spec §7), shared with the phone Guide. |
| `src/passages.ts` | Re-exports the shared passages for G2 screens. |
| `src/recorder.ts` / `src/wav.ts` | One mic capture at a time; G2 PCM (s16le, 16 kHz, mono) wrapped as WAV, with the measured byte rate logged. |
| `src/review/` | Card model (header, legend, cue; pairing expected vs detected to find the faulty note) and 288×144 card art. |
| `src/keyboard.ts` | Keyboard schematic for one finding as a 288×96 PNG (from #19). Not wired in: G2 has no Guide state since #16, and Review's card art draws its own keys. |
| `src/demo.ts` | Dev-only `?demo=review` gallery of every card in `shared/visual-examples.json`, labelled DEMO. |
| `src/staff.ts` | Draws a passage on a treble staff and splits it into two 288×112 PNG tiles. |
| `public/fonts/` | One-glyph Noto Music subset for the treble clef (SIL OFL, see `OFL.txt`). |
| `src/screens/` | One file per glasses state (spec §4). |

## Screens

| Mockup | State | Status |
|---|---|---|
| 01 | Selection | Native list (5 rows), tap to open, double tap to exit; no hints. Shown while the phone is on Library or History |
| 02 | Ready | Staff (2 image tiles), focus line, dimmed `tap ●` hint, double tap back |
| 03 | Recording | Tap ● (or Start on the phone) starts the session's source. Sheet music on: text swapped in place, staff stays (no image sends); off: just ■. `tap ■` stops and analyzes, `2× discard` throws the take away and returns to Ready |
| 04 | Analyzing | `analyzingScreen(stage)`: "Listening back…" plus a dimmed line with the phone pipeline's stage (preparing, uploading, analyzing, coaching); no input, no menu |
| 05 | Review | `reviewScreen({ coaching, onPlayAgain })`: one card per visual-plan card (art + ●/× legend + cue; × = what the mic heard), swipe between cards, tap → replay (what you played, then the fix, revealed note by note on staff cards; ends on the fix), double tap → Selection. Shown for the phone's review, guide and sheet states; unclear audio is a single card. Demo results are labelled DEMO. Dev gallery: open with `?demo=review` |
| — | Recoverable error | `problemScreen({ reason, onPlayAgain })`: plain-words reason (upload, analysis or server failure), tap → Selection |
| — | System menu | Tap then hold: "Hide/Show sheet music" item (no Settings screen); omitted while recording/analyzing |
