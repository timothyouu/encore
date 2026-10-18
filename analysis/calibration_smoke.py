"""Real-detector acceptance with known synthetic audio, not acoustic calibration."""
from __future__ import annotations

from copy import deepcopy
from argparse import ArgumentParser
from io import BytesIO
import json
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen
from uuid import uuid4
import wave

import numpy as np

from analysis.scoring import score_notes
from analysis.service import AttemptMetadata, DETECTOR_VERSION, _inspect_wav, _predict
from analysis.smoke import SAMPLE_RATE, synthetic_wav


def pcm_wav(samples: np.ndarray) -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(SAMPLE_RATE)
        recording.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return output.getvalue()


def samples_for(passage: dict[str, Any]) -> np.ndarray:
    with wave.open(BytesIO(synthetic_wav(passage)), "rb") as recording:
        return np.frombuffer(recording.readframes(recording.getnframes()), dtype="<i2").astype(np.float32) / 32768


def remote_result(url: str, wav: bytes, metadata: AttemptMetadata) -> dict[str, Any]:
    boundary = "encore-calibration-" + uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n'.encode()
            + metadata.model_dump_json().encode()
            + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="synthetic.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
            + wav + f'\r\n--{boundary}--\r\n'.encode())
    request = Request(url, data=body, headers={"Content-Type": "multipart/form-data; boundary=" + boundary}, method="POST")
    with urlopen(request, timeout=70) as response:
        return json.load(response)


def main() -> None:
    parser = ArgumentParser()
    parser.add_argument("--url", help="Optional local analysis endpoint for HTTP acceptance")
    args = parser.parse_args()
    passage = json.loads((Path(__file__).resolve().parents[1] / "shared/passages.json").read_text())[0]
    clean = samples_for(passage)
    wrong = deepcopy(passage)
    for index in (1, 3, 5, 7):
        wrong["notes"][index]["midiPitch"] += 1
    noise = np.random.default_rng(20261018).normal(0, 0.01, len(clean)).astype(np.float32)
    time = np.arange(len(clean)) / SAMPLE_RATE
    cases = {
        "clean": clean,
        "quiet": clean * 0.03,
        "background_noise": clean + noise,
        "room_hum": clean + 0.012 * np.sin(2 * np.pi * 50 * time) + noise * 0.3,
        "four_wrong_notes": samples_for(wrong),
        "noise_only": noise,
        "silence": np.zeros_like(clean),
    }
    report = []
    for label, samples in cases.items():
        wav = pcm_wav(samples)
        metadata = AttemptMetadata(attemptId="calibration-" + label, passageId=passage["id"],
                                   passageVersion=passage["version"], attemptTempoBpm=passage["tempoBpm"],
                                   sampleRate=SAMPLE_RATE, channels=1, encoding="pcm_s16le",
                                   durationSec=10, captureSource="test")
        if args.url:
            result = remote_result(args.url, wav, metadata)
            assert result["detectorVersion"] == DETECTOR_VERSION, "Analysis service is running old settings"
            notes = result["detectedNotes"]
        else:
            quality, audible = _inspect_wav(wav, metadata)
            notes = _predict(wav) if audible and not quality["clipped"] and not quality["hasDropouts"] else []
            result = score_notes(passage, metadata.attemptId, passage["tempoBpm"], notes, quality,
                                 detector_version=DETECTOR_VERSION, audible=audible)
        if label in ("silence", "noise_only"):
            assert result["status"] != "ok" and result["findings"] == [], (label, result)
        elif label == "four_wrong_notes":
            assert result["status"] == "ok", result
            assert sum(f["kind"] == "wrong_note" for f in result["findings"]) >= 3, result
        else:
            assert result["status"] == "ok" and result["metrics"]["matchedNotes"] >= 6, (label, result)
            if label == "room_hum":
                assert not any(f["kind"] == "extra_note" for f in result["findings"]), result
        report.append({"case": label, "status": result["status"],
                       "matchedNotes": result["metrics"]["matchedNotes"], "detectedNotes": len(notes),
                       "findingKinds": [finding["kind"] for finding in result["findings"]],
                       "warnings": result["audioQuality"]["warnings"]})
    print(json.dumps({"input": "synthetic harmonic tones/noise, not physical piano or G2",
                      "detectorVersion": DETECTOR_VERSION, "cases": report}, indent=2))


if __name__ == "__main__":
    main()
