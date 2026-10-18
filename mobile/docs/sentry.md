# Phone Sentry setup

Create a Browser JavaScript project in Sentry and copy its DSN from Client Keys. The phone app uses `@sentry/browser`. A Sentry auth token is not needed for browser event capture and must not be put in a `VITE_` variable.

Sentry is off by default. Use `mobile/.env.example` as the template for local Vite configuration:

```dotenv
VITE_SENTRY_ENABLED=true
VITE_SENTRY_DSN=https://PUBLIC_KEY@YOUR_SENTRY_HOST/PROJECT_ID
VITE_SENTRY_ENVIRONMENT=local
```

Restart Vite after changing these build-time values. The browser build includes the DSN when enabled. Leaving either `VITE_SENTRY_ENABLED` different from `true` or the DSN empty keeps Sentry inactive. This combined checkout has no Sentry local configuration copied into it.

A phone trace starts when microphone capture stops, when a test WAV enters processing, or when a saved attempt is retried. It follows recorder stop where applicable, WAV normalization, temporary audio persistence, artifact upload and validation, analysis request and validation, and coaching request and validation. Each retry gets a separate trace for the same saved attempt. Canceling or leaving the page closes pending spans. History persistence and phone rendering use separate `app.*` spans. The deterministic demo uses `demo.stop_to_result` with a simulated tag and does not call the services. Opening saved history does not start a processing trace.

Telemetry sends fixed stage and failure codes. It does not send audio bytes, request or response bodies, passage or coaching content, endpoint URLs, attempt IDs, or raw service error text. Browser auto integrations, replay, feedback, breadcrumbs, automatic network capture, and arbitrary trace propagation are disabled. Only explicitly named spans and sanitized error events are sent. Opt-in tracing samples at 100% for this hackathon; lower that before larger use if needed. Configure Sentry's server-side retention, IP handling, and access policy in the Sentry project.

The phone normalizes recorded audio to WAV, uploads it through the configured server, then submits the returned artifact ID to analysis and coaching. Failed attempts retain bounded local audio for retry, including IndexedDB storage when available. Distributed tracing headers are deliberately not sent to arbitrary configured endpoints. Backend instrumentation would need a separately reviewed contract for trusted origins, CORS, server-side ownership, and safe telemetry. G2 instrumentation belongs to the glasses workstream.

Local SDK tests inspect in-memory envelopes without contacting Sentry. A prior authorized synthetic run verified live receipt in [Encore / encore-mobile](https://encore-6e.sentry.io/projects/encore-mobile/); that run used the earlier phone pipeline and does not verify this combined checkout. See [historical Sentry verification](sentry-verification.md) and [combined shipping verification](../../docs/shipping-verification.md) for their respective evidence.
