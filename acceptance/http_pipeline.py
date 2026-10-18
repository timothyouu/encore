"""Real local HTTP acceptance: synthetic WAV -> Basic Pitch -> key-free coach."""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen
from uuid import uuid4

from analysis.smoke import synthetic_wav


def post(path: str, payload: dict) -> dict:
    request = Request("http://127.0.0.1:8788/v1/" + path,
                      data=json.dumps(payload).encode(),
                      headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=90) as response:
        return json.load(response)


def main() -> None:
    passage = json.loads((Path(__file__).resolve().parents[1] / "shared/passages.json").read_text())[0]
    wav = synthetic_wav(passage)
    attempt = "acceptance-" + uuid4().hex
    identity = {"attemptId": attempt, "passageId": passage["id"], "passageVersion": passage["version"]}
    metadata = {**identity, "attemptTempoBpm": passage["tempoBpm"], "sourceSampleRate": 22050,
                "sampleRate": 22050, "channels": 1, "encoding": "pcm_s16le", "durationSec": 10,
                "captureSource": "test"}
    artifact = post("recordings", {"metadata": metadata, "wavBase64": base64.b64encode(wav).decode()})
    assert artifact["sha256"] == hashlib.sha256(wav).hexdigest()
    repeated = post("recordings", {"metadata": metadata, "wavBase64": base64.b64encode(wav).decode()})
    assert repeated["artifactId"] == artifact["artifactId"]
    analysis = post("analyze", {**identity, "artifactId": artifact["artifactId"]})
    assert analysis["attemptId"] == attempt
    assert analysis["status"] == "ok", analysis
    assert analysis["metrics"]["matchedNotes"] == len(passage["notes"]), analysis
    coaching = post("coach", {"artifactId": artifact["artifactId"], "passageId": passage["id"],
                              "passageVersion": passage["version"], "analysis": analysis})
    assert coaching["attemptId"] == attempt
    assert coaching["coachingSource"] in ("fallback", "analysis_only"), "This acceptance run requires no API key"
    assert isinstance(coaching["visual"]["mistakes"], list)
    print(json.dumps({"status": "passed", "input": "synthetic tones, not live piano", "matchedNotes": analysis["metrics"]["matchedNotes"],
                      "coachingSource": coaching["coachingSource"], "sameArtifactOnRetry": True}))


if __name__ == "__main__":
    main()