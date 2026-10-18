"""Key-free Basic Pitch smoke test with synthetic P01 tones (not live piano evidence)."""
from __future__ import annotations

from argparse import ArgumentParser
from io import BytesIO
import json
from pathlib import Path
from time import perf_counter
from typing import Any
import wave

import numpy as np

from analysis.scoring import score_notes
from analysis.service import _predict

SAMPLE_RATE = 22050


def synthetic_wav(passage: dict[str, Any]) -> bytes:
    samples = np.zeros(int(SAMPLE_RATE * 10.0), dtype=np.float32)
    for note in passage["notes"]:
        start = 0.7 + note["onsetBeat"] * 60.0 / passage["tempoBpm"]
        duration = note["durationBeats"] * 60.0 / passage["tempoBpm"] * 0.75
        count = int(duration * SAMPLE_RATE)
        t = np.arange(count, dtype=np.float32) / SAMPLE_RATE
        frequency = 440.0 * 2 ** ((note["midiPitch"] - 69) / 12.0)
        envelope = np.minimum(1.0, t / 0.02) * np.exp(-2.2 * t)
        signal = (np.sin(2 * np.pi * frequency * t) + 0.3 * np.sin(4 * np.pi * frequency * t)) * envelope
        begin = int(start * SAMPLE_RATE)
        samples[begin:begin + count] += 0.22 * signal
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    output = BytesIO()
    with wave.open(output, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(SAMPLE_RATE)
        recording.writeframes(pcm)
    return output.getvalue()


def main() -> None:
    parser = ArgumentParser()
    parser.add_argument("passage_id", nargs="?", default="P01")
    args = parser.parse_args()
    passage = next(
        item for item in json.loads((Path(__file__).resolve().parents[1] / "shared" / "passages.json").read_text())
        if item["id"] == args.passage_id
    )
    started = perf_counter()
    detected = _predict(synthetic_wav(passage))
    elapsed = perf_counter() - started
    result = score_notes(
        passage, "synthetic-smoke", passage["tempoBpm"], detected,
        {"clipped": False, "hasDropouts": False, "warnings": []},
        detector_version="basic-pitch/0.4.0+tflite-icassp2022",
    )
    print(json.dumps({
        "input": "synthetic harmonic tones, not live piano",
        "passageId": passage["id"],
        "detectedPitches": [note["midiPitch"] for note in detected],
        "detectedOnsetsSec": [note["onsetSec"] for note in detected],
        "latencySec": round(elapsed, 2),
        "status": result["status"],
        "matchedNotes": result["metrics"]["matchedNotes"],
        "expectedNotes": result["metrics"]["expectedNotes"],
        "findings": result["findings"],
        "warnings": result["audioQuality"]["warnings"],
    }, indent=2))


if __name__ == "__main__":
    main()
