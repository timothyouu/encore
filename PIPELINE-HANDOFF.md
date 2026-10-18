# Updated WAV coaching pipeline

This implementation follows `spec.md` at `694ef65` and Granola's [Recording page audio pipeline and visualization architecture](https://notes.granola.ai/d/32613d5d-34e4-4c80-bbf1-be861adc3f34) (October 17, 2026).

## Run locally

The prepared WSL worktree is `/home/tim/projects/encore-wav-flow`. Existing approved dependencies are linked from the earlier local worktrees; do not delete those source environments while using these links.

```bash
cd /home/tim/projects/encore-wav-flow
bash scripts/start-local.sh
```

Configure the Git-ignored server/.env as described below. The key stays on the backend and is not sent to the browser. Open http://localhost:5176. Recording source defaults to Phone microphone. You can also import a WAV on the passage preview; imported audio is marked test audio. `--fallback` starts with provider calls disabled and uses labeled deterministic fallback coaching. Ctrl-C stops the local services. Startup/inference logs are under ignored `.run/`.

The launcher binds the phone UI, coaching server (8788), and Basic Pitch (8002) to localhost. This is a desktop-browser development setup. A physical phone requires a separately configured trusted HTTPS same-origin proxy to the laptop services. The remote server bearer token belongs in that proxy, never in client code or phone settings. No remote deployment or glasses connection is included.

## Data flow

1. Capture a bounded recording, decode actual samples, mix channels and resample to 22,050 Hz mono, then encode PCM16 WAV.
2. Upload once with attempt and passage identity. The server checks actual WAV headers/length and returns an expiring artifact URL, ID and SHA-256. Retry preserves the attempt count.
3. Basic Pitch receives the stored WAV. Deterministic alignment compares detected notes with the versioned passage, including separate onset and duration deltas.
4. The one Strands Gemini coach receives the same stored WAV bytes plus validated analysis. The installed Strands Google adapter needs a narrow inline-audio adapter; tests intercept the actual Google streaming request to verify the payload.
5. The coach selects one supported finding/action. Code constructs where/what/next summaries and evidence references. The phone resolves note pitches and lengths from saved evidence and renders keyboard/hold animations. There is no visualization LLM.

Uncertain analysis suppresses claims. Gemini errors, missing key or invalid choices use clearly labeled fallback. No supported findings produce an analysis-only result. History stores structured evidence, not audio; audio retry is available only while the tab retains it and server artifacts have bounded retention.

## Verification and limits

Run `bash scripts/verify.sh`. With the local stack running **without a key**, run `analysis/.venv/bin/python -m acceptance.http_pipeline` for actual synthetic WAV upload, real Basic Pitch inference and fallback coaching. This is synthetic audio evidence, not a live piano/hardware test.

See `verification-log.md` for checked results and remaining limits. Live Gemini credentials and physical G2/phone capture are not verified by injected-provider or fixture tests. `g2/` remains unchanged under the repository ownership rule. Its owner can consume the evidence contract separately; phone code contains no glasses bridge or display operations.
## Free-tier-only local setup

Provider configuration now comes exclusively from Git-ignored `server/.env`; ambient Gemini/Google keys and cloud credentials are not used. Paste only the API key for your verified Google AI Studio Free-tier project, enter its project ID, and set `ENCORE_FREE_TIER_VERIFIED=true` after verifying that exact key/project association and Free plan in AI Studio. This declaration is an operator confirmation, not programmatic billing verification or project routing. The key determines the project. Keep that project on Free tier: a local config cannot prevent charges if its Google billing tier is changed later.

Only Gemini Developer API and gemini-2.5-flash are allowed in startup configuration. Vertex AI is explicitly disabled. No alternate model/provider/key or paid fallback is configured. Google SDK attempts=1 and Strands retryStrategy=null disable automatic retries. HTTP429/RESOURCE_EXHAUSTED closes a process-lifetime provider circuit and returns HTTP429 gemini_quota_stopped, without local coaching fallback. Further attempts cannot call Gemini until a deliberate backend restart. Check quota/project state before restarting; do not switch keys to evade quotas. Other failures retain the existing no-cost deterministic fallback.

Run `bash scripts/start-local.sh` after editing the file; there is no longer a terminal key prompt. `--fallback` explicitly disables provider calls even if the file contains a key. Empty/placeholder keys leave Gemini disabled. No live API requests were made during this change. Google billing reference: https://ai.google.dev/gemini-api/docs/billing .