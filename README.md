# encore

## G2 glasses app (`g2/`)

### Setup

1. **Install Node.js 20 LTS or 22+.** Check with `node -v`. If you need to install or switch versions, use nvm, fnm, or Homebrew (`brew install node@22`).

2. **Install dependencies.** This also installs the Even Hub tooling (`@evenrealities/evenhub-cli` and `@evenrealities/evenhub-simulator`). Both are devDependencies, so you don't need a global install.
   ```bash
   cd g2
   npm install

3. **Install the Even Hub companion app** on your phone and pair it with your G2 glasses (only needed for testing on real hardware).

### Run

```bash
npm run dev        # dev server on :5173, bound to LAN
```

Then, in a second terminal, either:

- **Simulator (no glasses needed):** `npm run simulate`
- **Real glasses:** `npm run qr`, then scan the QR with the Even Hub phone app. This script uses your Mac's Wi-Fi IP (`en0`). On other OSes, run `npx evenhub qr --url http://<your-ip>:5173`.

### Pack

```bash
npm run pack       # build + pack into .ehpk
```

### Docs

- [Even Hub templates](https://github.com/even-realities/evenhub-templates): the `asr`, `image`, and `text-heavy` starters are useful references.
- SDK: [`@evenrealities/even_hub_sdk`](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)

## Phone companion (`mobile/`)

The phone UI is separate from the glasses application in `g2/`. The mobile app owns its source, tests, package configuration and documentation. It does not import the glasses app or SDK, write to glasses, handle glasses gestures, or package a glasses app. See `AGENTS.md` and spec section 9 for the side-effect boundary.

```sh
cd mobile
npm ci
npm run dev       # phone UI on :5176; glasses scaffold uses :5173
npm test
npm run build
```

See [mobile setup and limitations](mobile/README.md) and [verification handoff](mobile/docs/mobile-verification.md).

## Local audio, coaching, and persistence

The local stack normalizes phone audio to WAV, runs Basic Pitch through a Strands tool, and sends the same WAV plus measured findings to a Strands Gemini coach. History and settings remain in browser IndexedDB; audio has a bounded temporary retry window. Phone Sentry monitoring is opt-in and scrubs payloads.

See [pipeline setup](server/README.md), [analysis setup](analysis/README.md), [storage policy and checks](docs/storage-verification.md), and [Sentry setup](mobile/docs/sentry.md). Real `.env` files are ignored; only example templates belong in Git.

With dependencies already prepared, run `bash scripts/start-local.sh --fallback` for a local run without provider calls. To avoid an occupied phone port, use `ENCORE_MOBILE_PORT=5186 bash scripts/start-local.sh --fallback`. Run `bash scripts/verify-storage.sh` for the combined regression suite. Gemini access and physical device behavior require separate live verification.
