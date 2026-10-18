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

Results implement `AnalysisResult` in `spec.md`. A detected MIDI note outside the piano range 21–108, severe clipping, missing capture chunks, silence, too few anchors, or ambiguous offset suppresses musical findings. Basic Pitch detector scores are exposed as detector scores, never probabilities. `matchedNotes` counts pitch-correct aligned notes. `medianAbsTimingErrorMs` uses those same notes. Onset, pitch, and estimated note-event duration are scored. Duration findings require reliable alignment, clean audio, a correct-pitch pair and detector score at least 0.5. A difference must exceed both 200 ms and 25% of the expected duration. Signed durationDeltaMs is separate from onset timingDeltaMs. Weak duration evidence adds duration_evidence_weak and produces no duration claim. These are provisional detector-event comparisons, not measurements of physical key release or pedal sustain. Pedal, velocity, and fingering are not assessed. The 150 ms timing-finding threshold and alignment costs are provisional demo values; they require calibration with labeled phone and G2 recordings.

Run scoring tests and the real detector smoke test:

Scoring version `1.2.1-demo` anchors comparison to the first reliably matched played note and its reference onset. It keeps the WAV clock intact, ignores waiting before the entrance, and preserves missed opening notes and leading unmatched extras. It uses one fixed entrance offset, so later rhythm drift remains visible. Uncertain alignment still suppresses musical claims.

Analysis and phone History retain all supported findings. The phone offers a scrollable All mistakes list; glasses show at most ten distinct mistakes, ranked as: missing notes, extra notes, wrong pitches, timing, then duration. Timing and duration findings are ranked by absolute deviation, largest first, with stable passage-order ties. A missed note outranks a 300 ms timing error. The glasses limit never truncates saved evidence or full-attempt metrics. The shared TypeScript ranking mirrors this policy for visual cards, coach focus and History review; the visual summary still contains at most three cards.

```bash
analysis/.venv/bin/python -m unittest discover -s analysis/tests -v
analysis/.venv/bin/python -m analysis.smoke P01
analysis/.venv/bin/python -m analysis.smoke P02
```

The smoke test synthesizes simple harmonic tones from P01 in memory. It is test playback, not G2 audio or a measured live piano performance.

## Sensitive piano profile

`piano-sensitive-v1` uses Basic Pitch onset 0.35, frame 0.20, minimum event length 90 ms and the complete piano frequency range (27.5–4186.01 Hz). These are provisional detection settings, not retrained weights or physical-microphone calibration. The profile appears in `/health` and saved `detectorVersion`.

Audibility uses 100 ms windows at the existing RMS cutoff 0.0015, so waiting before a quiet entrance does not dilute the entire clip below the cutoff. Clipping affecting 0.5%–5% of samples adds `minor_clipping` without vetoing the take; 5% or more still blocks grading. Capture gaps and WAV integrity checks remain strict.

Alignment requires at least 60% paired-note coverage and max(2, ceil(35% of reference notes)) correct-pitch anchors, with ambiguity checks retained. A clear take containing several wrong notes can therefore receive feedback, while a short fragment remains uncertain. Unmatched events with detector scores below 0.35 remain in saved detected notes but produce only `weak_extra_note_evidence`, not extra-note corrections. Scores are model measurements, not calibrated probabilities. Existing duration evidence and onset tolerances are unchanged.

Run real-detector acceptance with reproducible synthetic quiet notes, background noise, hum, four wrong notes, noise-only and silence:

```bash
analysis/.venv/bin/python -m analysis.calibration_smoke
analysis/.venv/bin/python -m analysis.calibration_smoke --url http://127.0.0.1:8012/v1/analyze
```

Both modes verify detection against known notes; neither establishes performance with physical glasses or an acoustic piano. The original normalized WAV and its timestamps are preserved.