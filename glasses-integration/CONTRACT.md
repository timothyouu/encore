# Phone ↔ G2 integration contract (proposed)

**Status:** PROPOSED by the glasses owner on branch `g2/10-phone-integration`. Changes under `mobile/` sit in their own commits and need Timothy's review before merge. Nothing here is hardware-verified until a physical G2 pass is recorded.

## Shape

Even Hub loads one WebView page per app, so the phone UI that ships with the glasses app must run inside the page `g2/` serves.

```
g2/index.html (Even Hub WebView)
 └─ g2/src/main.ts            host boot (glasses workstream)
     ├─ mobile/src/phone.ts    phone DOM only (mountPhone)
     ├─ mobile/src/session.ts  SessionStore: the single source of truth
     ├─ mobile/src/capture.ts  submitAttempt: analysis → coaching
     └─ g2/src/controller.ts   store state → glasses screens; glasses input → store
         └─ g2/src/g2capture.ts G2 mic Recorder → WAV → submitAttempt
```

- Imports flow **g2 → mobile only**. `mobile/` still never imports the SDK, `g2/`, or a native bridge, and its boundary test stays unchanged.
- Every glasses side effect (containers, images, text, gestures, mic, Even storage) lives in `g2/`.
- The standalone mobile app (`mobile/`, :5174) keeps working as a phone-only build with Demo and Phone-mic sources.

## Ownership

| Concern | Owner | Location |
|---|---|---|
| Attempt records, counts, screen state, validation | Timothy | `mobile/src/session.ts` |
| Phone DOM | Timothy | `mobile/src/phone.ts`, `phone.css` |
| Analysis/coaching requests | Timothy | `mobile/src/capture.ts` (`submitAttempt`) |
| Host boot, bridge, glasses screens, gestures, G2 mic | Glasses owner | `g2/src/` |
| Passage data | Joint | `shared/passages.ts` |

## Seams mobile exposes (no glasses side effects)

1. `SessionStore.start('g2')` creates a record whose `captureSource` is `'g2'`. It's pure data: the store never touches a device.
2. `submitAttempt(store, endpoints, record, audio, context)` is the analysis → coaching pipeline that used to be private to `PhoneCapture`. `PhoneCapture` and the G2 driver share it, so validation, error stages, and stale-response handling stay identical.
3. `mountPhone` actions accept `getMode(): 'demo' | 'phone' | 'g2'` and an optional `deviceStatus(): string | null`. Without one, the UI keeps saying "Glasses integration not connected".
4. `mountConnection` accepts the list of recording sources to offer. The standalone app offers Demo and Phone. The G2 host adds G2 microphone.

## State map

| `SessionStore` screen | G2 state | G2 input → store call |
|---|---|---|
| `library`, `history` | Selection | list select → `showLibrary()` if needed, then `selectPassage(id)`; double tap → exit |
| `ready` | Ready | tap → host `start()`; double tap → `showLibrary()` |
| `recording` | Recording (same page as Ready; text swapped in place) | tap → host `stop()`; double tap → discard: `cancel()` then `selectPassage(same id)` |
| `processing` | Analyzing | none |
| `review` | Review | swipe down → `showGuide()`; tap or double tap → `showLibrary()` |
| `guide`, `sheet` | Guide | swipe up → `showReview()` (from `guide`); tap or double tap → `showLibrary()` |
| `error` | Recoverable error | tap or double tap → `showLibrary()` |

Phone and glasses inputs both change the store, and the controller redraws the glasses from it. It only rebuilds a page when the G2 state or passage changes. Ready ↔ Recording keeps the in-place text swap, so no image goes over BLE during capture.

## Capture rules

- G2 start: turn the mic on first, then call `store.start('g2')`. If the mic fails, nothing is recorded and the phone shows the error.
- Stop: mic off → `store.stop()` → `submitAttempt` with the WAV. Metadata: `captureSource: 'g2'`, `encoding: 'pcm_s16le'`, `sampleRateHz`, `channelCount`, `durationMs`, measured byte rate, chunk count.
- Discard (glasses double tap or phone Cancel): the take is never saved, counted, or submitted.
- Glasses exit or app close mid-take: mic off, then `store.interrupt()`.
- Phone and glasses share one 30s cap.

## Settings

`showSheetMusicWhilePlaying` stays G2-owned in Even app storage (`encore.displaySettings`), toggled from the G2 system menu. Mirroring it into the phone Settings sheet is stage 6. Until then, the phone copy is not shown as applied to glasses. `sheetMusicSize` and `showNoteNames` have no G2 rendering and are reported as phone-only.

## Connection status

The phone only says glasses are connected when the bridge is ready and the device reports connected. A saved setting, a simulator session, or a past G2 record is not evidence of a connected device.
