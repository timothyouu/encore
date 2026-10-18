# Phone ↔ G2 integration contract

**Status:** Implemented on the integration branch for review. The phone and glasses share one session; physical acceptance is tracked separately in `docs/physical-device-verification.md`. Local or simulated tests do not establish device behavior.

## Shape

Even Hub loads one WebView page per app, so the phone UI that ships with the glasses app must run inside the page `g2/` serves.

```
g2/index.html (Even Hub WebView)
 └─ g2/src/main.ts            host boot (glasses workstream)
     ├─ mobile/src/phone.ts    phone DOM only (mountPhone)
     ├─ mobile/src/session.ts  SessionStore: the single source of truth
     ├─ mobile/src/capture.ts  PhoneCapture.processRecording: normalize → upload → analysis → coaching
     └─ g2/src/controller.ts   store state → glasses screens; glasses input → store
         └─ g2/src/g2capture.ts G2 mic Recorder → WAV → processRecording
```

- Imports flow **g2 → mobile only**. `mobile/` still never imports the SDK, `g2/`, or a native bridge, and its boundary test stays unchanged.
- Every glasses side effect (containers, images, text, gestures, mic, Even storage) lives in `g2/`.
- The standalone mobile app (`mobile/`, :5176) keeps working as a phone-only build with the Phone-mic source.

## Ownership

| Concern | Owner | Location |
|---|---|---|
| Attempt records, counts, screen state, validation | Timothy | `mobile/src/session.ts` |
| Phone DOM | Timothy | `mobile/src/phone.ts`, `phone.css` |
| Recording pipeline (normalize, upload, analysis, coaching, retry) | Timothy | `mobile/src/capture.ts` (`PhoneCapture`) |
| Upload validation | Timothy | `server/src/recordings.ts` |
| Host boot, bridge, glasses screens, gestures, G2 mic | Glasses owner | `g2/src/` |
| Passage data | Joint | `shared/passages.ts` |

## Seams mobile exposes (no glasses side effects)

1. `SessionStore.start('g2')` creates a record whose `captureSource` is `'g2'`. It's pure data: the store never touches a device.
2. `PhoneCapture.processRecording(record, blob)` runs a completed attempt from another source through the phone's own pipeline: normalization to 22.05 kHz mono WAV, one upload, analysis, coaching, the retry window and History storage. The host gets it as `submit` and never touches the network itself. The server accepts `captureSource: 'g2'` on uploads, as the analysis service already does.
3. `mountPhone` actions accept `getMode(): 'phone' | 'g2'` and an optional `deviceStatus(): string | null`. Without one, the UI keeps saying "Glasses integration not connected".
4. `mountConnection` accepts the list of recording sources to offer. The standalone app offers Phone. The G2 host adds G2 microphone.

## State map

| `SessionStore` screen | G2 state | G2 input → store call |
|---|---|---|
| `library`, `history` | Selection | list select → `showLibrary()` if needed, then `selectPassage(id)`; double tap → exit |
| `ready` | Ready | tap → host `start()`; double tap → `showLibrary()` |
| `recording` | Recording (same page as Ready; text swapped in place) | tap → host `stop()`; double tap → discard: `cancel()` then `selectPassage(same id)` |
| `processing` | Analyzing | none |
| `review` | Review of selected finding/bar pair | swipe down or tap → matching Guide; swipe up → previous Guide; double tap → `showLibrary()` |
| `guide` | Correction for the same finding/bar pair | swipe down → next Review; swipe up → matching Review; tap → replay; double tap → `showLibrary()` |
| `sheet` | Review or Guide matching `sheetOrigin` and selected finding/bar | paging closes the phone sheet and calls `moveFeedback(delta)` |
| `error` | Recoverable error | tap or double tap → `showLibrary()` |

Phone and glasses inputs both change the store, and the controller redraws the glasses from it. It rebuilds a page when the G2 phase, selected finding/bar pair, saved attempt or passage changes. Ready ↔ Recording keeps the in-place text swap, so no image goes over BLE during capture.

Segment calculation and feedback ordering live in `shared/segments.ts` and `shared/feedback.ts`. The server validates Python detector results, enriches them into v2 locations/segments, and persists them with constrained code-written coaching. `SessionStore.entries()` exposes all finding/bar pairs; `selectedEntry()` resolves the current pair; `moveFeedback(delta)` walks Review → Guide → next Review (and back); `selectEntry(index)` opens a chosen pair's Review. The primary and other priority segments precede remaining affected bars, with unlocated findings last. The capped visual summary never caps navigation.

Phone and G2 Review/Guide show the same selected bar and finding. G2 paging closes an open phone Sheet overlay first. Notation clips at the saved bar boundaries; out-of-passage/unlocated findings have no inferred notation highlight. Legacy v1 results remain full-passage feedback without invented saved bar locations. Review tap opens the matching Guide; Guide tap replays its correction. Gallery fixtures keep their existing standalone replay controls.

Replay is G2 presentation state; neither paging nor replay creates a new attempt. Switching attempts, changing phase/pair, returning to selection, or leaving a page invalidates queued images and replay timers. History remains read-only and never resubmits audio. Physical G2 legibility, BLE delivery and gesture behavior remain device acceptance gates.

## Capture rules

- G2 start: turn the mic on first, then call `store.start('g2')`. If the mic fails, nothing is recorded and the phone shows the error.
- Stop: confirmed mic off → validate nonempty, even-byte PCM → `store.stop()` → `submit(record, WAV)`. The SDK format assumption is 16 kHz s16 mono; chunk/byte-rate/clipping diagnostics support physical checks. The pipeline really resamples to 22.05 kHz and uploads with `captureSource: 'g2'`. Empty or malformed capture is canceled before completion and is neither counted nor uploaded.
- Discard (glasses double tap or phone Cancel): the take is never saved, counted, or submitted.
- Glasses exit or app close mid-take: mic off, then `store.interrupt()`.
- Phone and glasses share one 30s cap.

## Network and authentication

The package couples its exact HTTPS service origin with its generated network whitelist. The host supplies absolute `/api/recordings`, `/api/analyze`, and `/api/coach` endpoints to the shared pipeline. The backend aliases these to the same authenticated `/v1` handlers; an API request never falls through to frontend HTML. A session-only bearer token is scoped to the configured origin and expected routes, is never saved or bundled, and is not forwarded through redirects. Configure CORS for the observed WebView origin with explicit operator approval; do not broadly allow origins or assume two WebViews share storage.

## Settings

`showSheetMusicWhilePlaying` stays G2-owned in Even app storage (`encore.displaySettings`), toggled from the G2 system menu. Mirroring it into the phone Settings sheet is stage 6. Until then, the phone copy is not shown as applied to glasses. `sheetMusicSize` and `showNoteNames` have no G2 rendering and are reported as phone-only.

## Connection status

The phone only says glasses are connected when the bridge is ready and the device reports connected. A saved setting, a simulator session, or a past G2 record is not evidence of a connected device.
