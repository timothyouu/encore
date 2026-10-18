"""Verify different WAV bytes reach real Basic Pitch and key-free coaching.
Run with analysis and offline coach services already listening locally.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen
from uuid import uuid4

from analysis.smoke import synthetic_wav


def post(base: str, route: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = Request(base + "/v1/" + route, data=json.dumps(payload).encode(),
                      headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=90) as response:
        return json.load(response)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8826")
    args = parser.parse_args()
    passage = json.loads((Path(__file__).resolve().parents[1] / "shared/passages.json").read_text())[0]
    altered = deepcopy(passage)
    altered["notes"][2]["midiPitch"] += 1
    quiet = deepcopy(passage)
    quiet["notes"] = []
    results: dict[str, Any] = {}
    hashes: set[str] = set()
    for label, score in [("reference", passage), ("wrong_note", altered), ("silence", quiet)]:
        wav = synthetic_wav(score)
        identity = {"attemptId": "audio-acceptance-" + uuid4().hex,
                    "passageId": passage["id"], "passageVersion": passage["version"]}
        metadata = {**identity, "attemptTempoBpm": passage["tempoBpm"], "sourceSampleRate": 22050,
                    "sampleRate": 22050, "channels": 1, "encoding": "pcm_s16le", "durationSec": 10,
                    "captureSource": "test"}
        uploaded = post(args.base, "recordings", {"metadata": metadata, "wavBase64": base64.b64encode(wav).decode()})
        assert uploaded["sha256"] == hashlib.sha256(wav).hexdigest()
        hashes.add(uploaded["sha256"])
        analysis = post(args.base, "analyze", {**identity, "artifactId": uploaded["artifactId"]})
        assert analysis["attemptId"] == identity["attemptId"]
        assert not analysis["detectorVersion"].startswith("demo")
        if label == "silence":
            assert analysis["status"] != "ok", analysis
            assert analysis["findings"] == [], analysis
        else:
            assert analysis["status"] == "ok", analysis
            if label == "reference":
                assert analysis["metrics"]["matchedNotes"] == len(passage["notes"]), analysis
            else:
                assert any(f["kind"] == "wrong_note" for f in analysis["findings"]), analysis
            coach = post(args.base, "coach", {"artifactId": uploaded["artifactId"],
                "passageId": passage["id"], "passageVersion": passage["version"], "analysis": analysis})
            assert coach["attemptId"] == identity["attemptId"]
            assert coach["coachingSource"] in ("fallback", "analysis_only"), coach
            assert set(coach["evidenceFindingIds"]).issubset({f["id"] for f in analysis["findings"]})
        results[label] = {"status": analysis["status"], "detectedPitches": [n["midiPitch"] for n in analysis["detectedNotes"]],
                          "findingKinds": [f["kind"] for f in analysis["findings"]]}
    assert len(hashes) == 3
    assert results["reference"]["detectedPitches"] != results["wrong_note"]["detectedPitches"]
    print(json.dumps({"passed": 3, "input": "synthetic WAV, not physical microphone", "results": results}, indent=2))


if __name__ == "__main__":
    main()
