# Encore phone companion

This folder contains the mobile UI independently of `../g2/`, which remains the glasses workstream.

## Run and verify

Use Node 22.14 or newer. From this folder run `npm ci`, `npm run dev`, `npm test`, and `npm run build`. The development URL is http://localhost:5174. The glasses app can run separately on port 5173.

`src/phone.ts` and `phone.css` implement the Paper-derived UI. `session.ts` and `passages.ts` provide validated attempt state and reference data. `capture.ts` handles phone microphone recording and configured analysis/coaching services. Tests live in `tests/`.

This app renders only on the phone. It must not import an Even Hub/native glasses bridge, write glasses containers, or handle glasses gestures. The former `display.ts` adapter violated this boundary and has been removed. Glasses integration is unavailable here; future integration needs a separately authorized contract with the owner of `g2/`. `npm test` includes a boundary regression to prevent reintroduction. See [repository instructions](../AGENTS.md).

Demo mode uses clearly labeled sample results without microphone access. To test real phone capture, configure full HTTPS analysis/coaching endpoint URLs in Connection settings. The backend services and physical G2 microphone work are separate integrations; they have not been live-verified here. No provider keys belong in the phone client.

See [verification and integration details](docs/mobile-verification.md) and [Paper exports](docs/paper/).
