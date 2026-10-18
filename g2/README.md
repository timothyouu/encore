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

Node's built-in test runner on the TypeScript sources (no extra dependencies; relative imports carry `.ts` so Node can resolve them). `tests/fakes.mjs` stands in for the Even bridge, so screens, input, recording, upload and the glasses queue run without hardware. Staff drawing is covered through `staffLayout()`, the canvas-free layout step.

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
| `src/main.ts` | Boots the bridge, routes normalized input to the current screen. |
| `src/glasses.ts` | Serialized, time-limited bridge calls; startup page vs. rebuild. |
| `src/input.ts` | Maps SDK events to `tap` / `doubleTap` / `swipeUp` / `swipeDown` / `listSelect` / `menuItem`; drops duplicates and any tap that belongs to a long press. |
| `src/settings.ts` | Display settings (spec §5), saved in Even app storage, and the sheet-music system-menu item. |
| `src/layout.ts` | Shared geometry from the Paper mockups; right-aligned text via `@evenrealities/pretext`. |
| `../shared/passages.ts` | The six approved seed passages and authored fingerings (spec §7), shared with the phone Guide. |
| `src/passages.ts` | Re-exports the shared passages for G2 screens. |
| `src/recorder.ts` / `src/wav.ts` | One capture per attempt ID; G2 PCM (s16le, 16 kHz, mono) wrapped as WAV, with the measured byte rate logged. |
| `src/upload.ts` / `src/phone.ts` | Multipart upload (`audio` + `metadata`) to the Upload URL set on the phone screen. |
| `src/review/` | Card model (header, legend, cue; pairing expected vs detected to find the faulty note) and 288×144 card art. |
| `src/staff.ts` | Draws a passage on a treble staff and splits it into two 288×112 PNG tiles. |
| `public/fonts/` | One-glyph Noto Music subset for the treble clef (SIL OFL, see `OFL.txt`). |
| `src/screens/` | One file per glasses state (spec §4). |

## Screens

| Mockup | State | Status |
|---|---|---|
| 01 | Selection | Native list (5 rows), tap to open, double tap to exit; no hints |
| 02 | Ready | Staff (2 image tiles), focus line, dimmed `tap ●` hint, double tap back |
| 03 | Recording | Tap ● starts the G2 mic. Sheet music on: text swapped in place, staff stays (no image sends); off: just ■. `tap ■` stops and uploads, `2× discard` throws the take away; 30s cap |
| (04) | Saving | Interim until Analyzing: uploads the take; saved → tap → selection; couldn't save → tap or double tap → back to Ready |
| 04 | Analyzing | `analyzingScreen(stage)`: "Listening back…" plus a dimmed stage line; no input, no menu |
| 05 | Review | `reviewScreen({ coaching, onPlayAgain })`: one card per visual-plan card (art + ●/○ legend + cue), swipe between cards, double tap → selection. Dev gallery: open with `?demo=review` |
| — | Recoverable error | `problemScreen({ reason, onPlayAgain })`: plain-words reason, tap → selection |
| — | System menu | Tap then hold: "Hide/Show sheet music" item (no Settings screen); omitted while recording/analyzing |
