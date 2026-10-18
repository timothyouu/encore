# Laptop audio analysis

Run from the repository root in WSL with Python 3.10 on x86-64:

```bash
python3 -m venv analysis/.venv
analysis/.venv/bin/python -m pip install -r analysis/requirements.lock.txt
analysis/.venv/bin/python -m uvicorn analysis.service:app --host 127.0.0.1 --port 8002
```

The lock file captures the tested Python 3.10 WSL environment; requirements.txt lists the direct dependencies. The service loads the bundled Basic Pitch TFLite model once at startup. `GET /health` returns HTTP 200 with `{"status":"ok","modelLoaded":true}` when ready, or HTTP 503 if model loading failed. The localhost bind is for development; the phone will need a separately configured reachable HTTPS route.

`POST /v1/analyze` takes exactly two multipart fields: `audio` (PCM 16-bit little-endian WAV) and `metadata` (JSON string). Example metadata:

```json
{
  "attemptId": "attempt-123",
  "passageId": "P01",
  "passageVersion": "1",
  "attemptTempoBpm": 60,
  "sampleRate": 22050,
  "channels": 1,
  "encoding": "pcm_s16le",
  "durationSec": 8.5,
  "captureSource": "phone",
  "missingChunkCount": 0,
  "expectedSampleCount": 187425
}
```

The last two fields are optional; report missing chunk sequences when known. The service validates the actual WAV header, frame count, duration and metadata, and refuses a mismatch. It accepts 16–48 kHz mono/stereo, 1–30 seconds, and at most 8 MiB for the full multipart body. One inference is admitted at a time; another request gets HTTP 503 and should retry with the same attempt ID. Inference has a 60-second response timeout; the worker keeps its admission slot until it actually finishes. Audio is held only in bounded request memory and an automatically deleted temporary WAV file during Basic Pitch inference. Structured results are returned; the service does not save attempt audio or results.

Results implement `AnalysisResult` in `spec.md`. A detected MIDI note outside the piano range 21–108, clipping, missing capture chunks, silence, too few anchors, or ambiguous offset suppresses musical findings. Basic Pitch detector scores are exposed as detector scores, never probabilities. `matchedNotes` counts pitch-correct aligned notes. `medianAbsTimingErrorMs` uses those same notes. Onset, pitch, and estimated note-event duration are scored. Duration findings require reliable alignment, clean audio, a correct-pitch pair and detector score at least 0.5. A difference must exceed both 200 ms and 25% of the expected duration. Signed durationDeltaMs is separate from onset timingDeltaMs. Weak duration evidence adds duration_evidence_weak and produces no duration claim. These are provisional detector-event comparisons, not measurements of physical key release or pedal sustain. Pedal, velocity, and fingering are not assessed. The 150 ms timing-finding threshold and alignment costs are provisional demo values; they require calibration with labeled phone and G2 recordings.

Run scoring tests and the real detector smoke test:

```bash
analysis/.venv/bin/python -m unittest discover -s analysis/tests -v
analysis/.venv/bin/python -m analysis.smoke P01
analysis/.venv/bin/python -m analysis.smoke P02
```

The smoke test synthesizes simple harmonic tones from P01 in memory. It is test playback, not G2 audio or a measured live piano performance.

