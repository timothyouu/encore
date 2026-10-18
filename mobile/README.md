# Encore phone companion

This folder contains the mobile UI independently of `../g2/`, which remains the glasses workstream.

## Run and verify

Use Node 22.14 or newer and existing installed dependencies. From this folder run `npm run dev`, `npm test`, and `npm run build`. The development URL is http://localhost:5176. Vite listens on loopback by default and forwards `/api/*` to `http://127.0.0.1:8788/v1/*`; run the local API there before a real capture. Physical phone access requires a separately secured connection to the server. The glasses app can run separately on port 5173.

`src/phone.ts` and `phone.css` implement the Paper-derived UI. `session.ts` provides validated attempt state. `src/passages.ts` exposes the pure authored reference data in `../shared/passages.ts`, which both phone and G2 consume; the phone Guide shows a finger only when that note has a supported authored suggestion. `capture.ts` handles phone microphone recording and configured analysis/coaching services. Tests live in `tests/`.

This app renders only on the phone. It must not import an Even Hub/native glasses bridge, write glasses containers, or handle glasses gestures. The former `display.ts` adapter violated this boundary and has been removed. Glasses integration is unavailable here; future integration needs a separately authorized contract with the owner of `g2/`. `npm test` includes a boundary regression to prevent reintroduction. See [repository instructions](../AGENTS.md).

The default source is the phone microphone. Captured media is decoded in the browser, downmixed to mono, resampled to 22,050 Hz, and encoded as PCM16 WAV. The phone uploads those WAV bytes to `/api/recordings`, then sends the returned artifact ID to `/api/analyze` and `/api/coach`. The server retrieves the same temporary WAV for each stage. Failures retain the completed attempt and its stage; retry uses its saved audio in the current tab with the same attempt ID. Reloading discards raw audio, so a failed attempt can only be retried while that tab remains open. The optional WAV import is labeled as test input in History.

Connection settings permit HTTPS service endpoints or local development URLs. Demo mode uses visibly labeled sample results without microphone or server access. Physical G2 microphone capture has not been verified here. No provider keys belong in the phone client.

See [verification and integration details](docs/mobile-verification.md) and [Paper exports](docs/paper/).
