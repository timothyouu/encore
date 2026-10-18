"""Independent spectrum checks for capture-path investigation."""
from __future__ import annotations

from io import BytesIO
import unittest
import wave
import numpy as np
from analysis.audio_diagnostics import signal_summary


class SignalSummaryTests(unittest.TestCase):
    def test_distinct_notes_and_silence_keep_frequency_and_clock(self) -> None:
        rate = 22050
        time = np.arange(rate) / rate
        frames = np.concatenate([np.zeros(rate), 0.2 * np.sin(2 * np.pi * 261.63 * time),
                                 0.2 * np.sin(2 * np.pi * 392.0 * time)])
        output = BytesIO()
        with wave.open(output, "wb") as recording:
            recording.setnchannels(1)
            recording.setsampwidth(2)
            recording.setframerate(rate)
            recording.writeframes((frames * 32767).astype("<i2").tobytes())
        summary = signal_summary(output.getvalue())
        windows = summary["frequencyWindows"]
        self.assertEqual(summary["durationSec"], 3)
        self.assertGreaterEqual(windows[0]["onsetSec"], 0.99)
        self.assertTrue(all(abs(item["dominantHz"] - 261.63) < 5 for item in windows if item["onsetSec"] < 1.99))
        self.assertTrue(all(abs(item["dominantHz"] - 392) < 5 for item in windows if item["onsetSec"] >= 2))
        self.assertNotIn("samples", summary)
