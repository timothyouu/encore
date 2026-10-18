# Encore WAV service

The Node 22 TypeScript server receives one normalized WAV per attempt, keeps it in a short lived memory store, forwards the same bytes to the laptop Basic Pitch service, and attaches those bytes to the Gemini Coach request. It uses a direct Strands tool call for Basic Pitch and one Strands Agent invocation for Gemini. No model produces visual layout or measurements.

## Local run

From `server/`, run `npm run dev` with the existing dependencies. Defaults are `127.0.0.1:8788`, browser origin `http://localhost:5176`, and Basic Pitch endpoint `http://127.0.0.1:8002/v1/analyze`. Set `ENCORE_ANALYSIS_URL` to a fixed loopback URL ending in `/v1/analyze` if the Python port differs. `ENCORE_COACH_PORT`, `ENCORE_ALLOWED_ORIGIN`, and `ENCORE_PUBLIC_BASE_URL` configure the server port, exact CORS origin, and returned audio URL base. Provider settings are loaded only from the ignored `server/.env` file, starting from `server/.env.example`. Gemini requires an explicit `gemini-2.5-flash` model and the Free-tier project confirmation described below; without a key, results are labeled `fallback` or `analysis_only`. Ambient provider credentials are ignored.

When binding to a non-loopback host, `ENCORE_COACH_TOKEN` must be at least 32 characters and `ENCORE_ALLOWED_ORIGIN` must use HTTPS. The bearer token protects all recording and processing routes. The WAV URL is temporary and requires the same authorization when a token is configured; it is not a permanent public media URL.

## API

`POST /v1/recordings` accepts JSON:

```json
{
  "metadata": {
    "attemptId": "attempt-1", "passageId": "P01", "passageVersion": "1",
    "attemptTempoBpm": 60, "sourceSampleRate": 48000, "sampleRate": 22050,
    "channels": 1, "encoding": "pcm_s16le", "durationSec": 8,
    "captureSource": "phone"
  },
  "wavBase64": "<base64 of RIFF WAV bytes>"
}
```

It returns the metadata plus `artifactId`, `audioUrl`, `expiresAt`, `sha256`, and `mimeType: "audio/wav"`. `GET /v1/recordings/:artifactId/audio` returns the exact WAV bytes until expiry. This URL is for temporary authorized retrieval; the processing endpoints read the stored bytes directly.

`POST /v1/analyze` accepts `{ "artifactId": "...", "attemptId": "attempt-1", "passageId": "P01", "passageVersion": "1" }`. It calls the fixed Python endpoint with multipart fields `audio` (WAV file) and `metadata` (JSON string) and returns validated `AnalysisResult`. Concurrent retries share one Basic Pitch call.

`POST /v1/coach` accepts `{ "artifactId": "...", "passageId": "P01", "passageVersion": "1", "analysis": <the matching AnalysisResult> }`. The server requires the exact cached analysis from that artifact. It returns `CoachingResult`, including evidence linked `visual.mistakes` IDs. Concurrent retries share one Gemini call. Uncertain or poor audio receives an `analysis_only` retry cue.

Uploads are limited to 30 seconds of mono 22,050 Hz, 16-bit PCM WAV and 1.35 MB of WAV bytes. RIFF header, actual data duration, passage, and metadata are checked before storage. Artifacts expire after ten minutes, including an idle cleanup timer, and are retained throughout analysis, coaching, and a bounded retry window. Same attempt ID and bytes/metadata return the same artifact; a changed upload returns 409. Missing or expired artifacts return 410. There are 30 requests per minute per address. Processing failures keep the artifact available for retry until expiry. Health reports configuration, not live provider success.

The installed Strands 1.21.0 Google adapter omits `audioBlock` when formatting Gemini requests. `src/coaching.ts` adapts the underlying Google GenAI streaming request by adding an inline `audio/wav` part to the same Strands Agent user message. Google documents inline WAV input in its [audio understanding guide](https://ai.google.dev/gemini-api/docs/generate-content/audio). The server tests inspect the actual outbound `generateContentStream` parameters and compare decoded audio bytes with the upload. These are mocked tests; a live Gemini response and actual Basic Pitch inference remain separate integration checks.

Run `npm run typecheck` and `npm test` for local verification.

## Free-tier-only local setup

Provider configuration now comes exclusively from Git-ignored `server/.env`; ambient Gemini/Google keys and cloud credentials are not used. Paste only the API key for your verified Google AI Studio Free-tier project, enter its project ID, and set `ENCORE_FREE_TIER_VERIFIED=true` after verifying that exact key/project association and Free plan in AI Studio. This declaration is an operator confirmation, not programmatic billing verification or project routing. The key determines the project. Keep that project on Free tier: a local config cannot prevent charges if its Google billing tier is changed later.

Only Gemini Developer API and gemini-2.5-flash are allowed in startup configuration. Vertex AI is explicitly disabled. No alternate model/provider/key or paid fallback is configured. Google SDK attempts=1 and Strands retryStrategy=null disable automatic retries. HTTP429/RESOURCE_EXHAUSTED closes a process-lifetime provider circuit and returns HTTP429 gemini_quota_stopped, without local coaching fallback. Further attempts cannot call Gemini until a deliberate backend restart. Check quota/project state before restarting; do not switch keys to evade quotas. Other failures retain the existing no-cost deterministic fallback.

Run `bash scripts/start-local.sh` after editing the file; there is no longer a terminal key prompt. `--fallback` explicitly disables provider calls even if the file contains a key. Empty/placeholder keys leave Gemini disabled. No live API requests were made during this change. Google billing reference: https://ai.google.dev/gemini-api/docs/billing .