# Encore phone companion

This folder contains the mobile UI independently of `../g2/`, which remains the glasses workstream.

## Run and verify

Use Node 22.14 or newer and existing installed dependencies. From this folder run `npm run dev`, `npm test`, and `npm run build`. The development URL is http://localhost:5176. Vite listens on loopback by default and forwards `/api/*` to `http://127.0.0.1:8788/v1/*`; run the local API there before a real capture. Physical phone access requires a separately secured connection to the server. The glasses app can run separately on port 5173.

`src/phone.ts` and `phone.css` implement the Paper-derived UI. `session.ts` provides validated attempt state. `src/passages.ts` exposes the pure authored reference data in `../shared/passages.ts`, which both phone and G2 consume; the phone Guide shows a finger only when that note has a supported authored suggestion. `capture.ts` handles the shared processing pipeline for G2 recordings and configured analysis/coaching services. Tests live in `tests/`.

This app renders only on the phone. It must not import an Even Hub/native glasses bridge, write glasses containers, or handle glasses gestures. The former `display.ts` adapter violated this boundary and has been removed. The standalone phone build does not create a glasses connection. The G2 host can mount `startPhoneApp` from `src/app.ts` and supply its capture driver and device status; imports and device side effects remain owned by `g2/`. `npm test` includes a boundary regression to prevent reintroduction. See [repository instructions](../AGENTS.md).

G2 is the only capture source. The G2 host supplies audio to the shared processing pipeline, which decodes it, downmixes to mono, resamples to 22,050 Hz, and encodes it as PCM16 WAV. The app uploads those WAV bytes to `/api/recordings`, then sends the returned artifact ID to `/api/analyze` and `/api/coach`. The server retrieves the same temporary WAV for each stage. Failures retain the completed attempt and its stage; retry uses its saved audio with the same attempt ID. When IndexedDB is available, failed recordings can be retried after reload within the bounded 10-minute retention window. Completed results remain in History without raw audio.

Connection settings permit HTTPS service endpoints or local development URLs. Only the G2 host can start a capture; the standalone mobile page has no capture source attached. G2 recordings use the shared session, upload/analysis/coaching pipeline, and History. There is no simulated recording source. The reference songs and sheet music remain authored static content. Old demo History entries retain their simulated labels. Physical G2 capture has not been verified here. No provider keys belong in the phone client.

See [verification and integration details](docs/mobile-verification.md) and [Paper exports](docs/paper/).

See [audio-driven acceptance and bounded verification loop](../docs/AUDIO-LOOP.md) for automated checks and their limits.
