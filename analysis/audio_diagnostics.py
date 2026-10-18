"""Private numeric capture diagnostics; no samples or recording are retained."""
from __future__ import annotations

from io import BytesIO
from typing import Any
import wave

import numpy as np


def signal_summary(wav_bytes: bytes) -> dict[str, Any]:
    with wave.open(BytesIO(wav_bytes), "rb") as recording:
        sample_rate = recording.getframerate()
        channels = recording.getnchannels()
        samples = np.frombuffer(recording.readframes(recording.getnframes()), dtype="<i2")
    mono = samples.astype(np.float64).reshape(-1, channels).mean(axis=1) / 32768.0
    window_size = round(sample_rate * 0.25)
    windows: list[dict[str, float]] = []
    for start in range(0, len(mono) - window_size + 1, window_size):
        frame = mono[start:start + window_size]
        rms = float(np.sqrt(np.mean(frame ** 2)))
        if rms < 0.0015:
            continue
        spectrum = np.abs(np.fft.rfft((frame - frame.mean()) * np.hanning(window_size)))
        frequencies = np.fft.rfftfreq(window_size, 1 / sample_rate)
        spectrum[(frequencies < 27.5) | (frequencies > 4186.01)] = 0
        peak = int(np.argmax(spectrum))
        windows.append({"onsetSec": round(start / sample_rate, 3), "rms": round(rms, 5),
                        "dominantHz": round(float(frequencies[peak]), 2)})
    return {"sampleRate": sample_rate, "channels": channels,
            "durationSec": round(len(mono) / sample_rate, 4), "frequencyWindows": windows}
