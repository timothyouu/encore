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
| `src/staff.ts` | Draws a passage on a treble staff and splits it into two 288×112 PNG tiles. |
| `public/fonts/` | One-glyph Noto Music subset for the treble clef (SIL OFL, see `OFL.txt`). |
| `src/screens/` | One file per glasses state (spec §4). |

## Screens

| Mockup | State | Status |
|---|---|---|
| 01 | Selection | Native list (5 rows), tap to open, double tap to exit; no hints |
| 02 | Ready | Staff (2 image tiles), focus line, dimmed `tap ●` hint (recording not wired yet), double tap back |
| — | System menu | Tap then hold: "Hide/Show sheet music" item (no Settings screen); omitted while recording/analyzing |
