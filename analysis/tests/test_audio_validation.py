"""WAV metadata and audio-quality gates without loading Basic Pitch."""
from __future__ import annotations

from io import BytesIO
import unittest
from typing import Any
import wave

from fastapi import HTTPException

from analysis.service import AttemptMetadata, _inspect_wav


def metadata(**changes: Any) -> AttemptMetadata:
    data: dict[str, Any] = {
        "attemptId": "validation-test",
        "passageId": "P01",
        "passageVersion": "1",
        "attemptTempoBpm": 60,
        "sampleRate": 22050,
        "channels": 1,
        "encoding": "pcm_s16le",
        "durationSec": 2,
        "captureSource": "test",
    }
    data.update(changes)
    return AttemptMetadata.model_validate(data)


def wav_samples(sample: int = 0) -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(22050)
        recording.writeframes(sample.to_bytes(2, "little", signed=True) * 44100)
    return output.getvalue()


class AudioValidationTests(unittest.TestCase):
    def test_silence_is_not_a_musical_error(self) -> None:
        quality, audible = _inspect_wav(wav_samples(), metadata())
        self.assertFalse(audible)
        self.assertIn("low_level", quality["warnings"])

    def test_clipping_and_gap_flags(self) -> None:
        quality, audible = _inspect_wav(
            wav_samples(32767),
            metadata(missingChunkCount=1, expectedSampleCount=50000),
        )
        self.assertTrue(audible)
        self.assertTrue(quality["clipped"])
        self.assertTrue(quality["hasDropouts"])

    def test_metadata_must_match_actual_wav(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            _inspect_wav(wav_samples(), metadata(sampleRate=16000))
        self.assertEqual(raised.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()

