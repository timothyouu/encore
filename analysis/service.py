"""Bounded laptop Basic Pitch analysis endpoint for short PCM WAV attempts."""
from __future__ import annotations

import asyncio
import audioop
from array import array
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
from threading import Lock, Semaphore
from typing import Any, AsyncIterator, Literal
import wave

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.datastructures import UploadFile
from starlette.requests import Request as StarletteRequest
from starlette.types import Message

from analysis.scoring import score_notes

MAX_BODY_BYTES = 8 * 1024 * 1024
MAX_AUDIO_SECONDS = 30.0
DETECTOR_VERSION = "basic-pitch/0.4.0+tflite-icassp2022+piano-sensitive-v1"
PIANO_DETECTION = {
    "onset_threshold": 0.35,
    "frame_threshold": 0.20,
    "minimum_note_length": 90.0,
    "minimum_frequency": 27.5,  # A0, MIDI 21
    "maximum_frequency": 4186.01,  # C8, MIDI 108
}
AUDIBLE_WINDOW_SEC = 0.10
MIN_AUDIBLE_RMS = 0.0015
MINOR_CLIPPING_FRACTION = 0.005
SEVERE_CLIPPING_FRACTION = 0.05
PASSAGES_PATH = Path(__file__).resolve().parents[1] / "shared" / "passages.json"
_MODEL: Any = None
_MODEL_ERROR = False
_MODEL_LOCK = Lock()
_INFERENCE_LOCK = Lock()
_ADMISSION = Semaphore(1)
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="encore-inference")


class AttemptMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attemptId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    passageId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,32}$")
    passageVersion: str = Field(pattern=r"^[A-Za-z0-9_.-]{1,32}$")
    attemptTempoBpm: float = Field(ge=30, le=240)
    sourceSampleRate: int | None = Field(default=None, ge=8000, le=192000)
    sampleRate: int = Field(ge=16000, le=48000)
    channels: Literal[1, 2]
    encoding: Literal["pcm_s16le"]
    durationSec: float = Field(ge=1, le=MAX_AUDIO_SECONDS)
    captureSource: Literal["g2", "phone", "test"]
    missingChunkCount: int = Field(default=0, ge=0, le=10000)
    expectedSampleCount: int | None = Field(default=None, ge=1, le=1_440_000)


def _passages() -> dict[str, dict[str, Any]]:
    library = json.loads(PASSAGES_PATH.read_text(encoding="utf-8"))
    return {passage["id"]: passage for passage in library}


def _get_model() -> Any:
    global _MODEL
    with _MODEL_LOCK:
        if _MODEL is None:
            from basic_pitch import ICASSP_2022_MODEL_PATH
            from basic_pitch.inference import Model

            _MODEL = Model(ICASSP_2022_MODEL_PATH)
        return _MODEL


def _predict(wav_bytes: bytes) -> list[dict[str, Any]]:
    from basic_pitch.inference import predict
    from contextlib import redirect_stdout
    from io import StringIO

    with _INFERENCE_LOCK:
        model = _get_model()
        with tempfile.NamedTemporaryFile(suffix=".wav", prefix="encore-", delete=True) as temporary:
            temporary.write(wav_bytes)
            temporary.flush()
            with redirect_stdout(StringIO()):
                _, _, events = predict(temporary.name, model_or_model_path=model, **PIANO_DETECTION)
    notes: list[dict[str, Any]] = []
    for index, event in enumerate(sorted(events, key=lambda item: (item[0], item[2])), 1):
        onset, end, pitch, score, _ = event
        if 0 <= pitch <= 127 and end > onset:
            notes.append({
                "id": f"d{index}",
                "midiPitch": int(pitch),
                "onsetSec": round(float(onset), 4),
                "durationSec": round(float(end - onset), 4),
                "detectorScore": round(float(score), 4),
            })
    return notes


def _predict_admitted(wav_bytes: bytes) -> list[dict[str, Any]]:
    try:
        return _predict(wav_bytes)
    finally:
        _ADMISSION.release()


def _inspect_wav(wav_bytes: bytes, metadata: AttemptMetadata) -> tuple[dict[str, Any], bool]:
    if len(wav_bytes) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Audio exceeds size limit")
    try:
        with wave.open(BytesIO(wav_bytes), "rb") as recording:
            sample_rate = recording.getframerate()
            channels = recording.getnchannels()
            sample_width = recording.getsampwidth()
            frame_count = recording.getnframes()
            compression = recording.getcomptype()
            frames = recording.readframes(frame_count)
    except (wave.Error, EOFError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Invalid WAV audio") from exc
    if (sample_rate, channels, sample_width, compression) != (
        metadata.sampleRate, metadata.channels, 2, "NONE"
    ):
        raise HTTPException(status_code=422, detail="WAV format differs from metadata")
    if sample_rate < 16000 or sample_rate > 48000 or channels not in (1, 2):
        raise HTTPException(status_code=422, detail="Unsupported WAV format")
    if len(frames) != frame_count * channels * sample_width:
        raise HTTPException(status_code=422, detail="Truncated WAV audio")
    duration = frame_count / sample_rate
    if duration < 1 or duration > MAX_AUDIO_SECONDS or abs(duration - metadata.durationSec) > 0.05:
        raise HTTPException(status_code=422, detail="WAV duration differs from metadata or exceeds limit")
    if len(frames) == 0:
        raise HTTPException(status_code=422, detail="Empty WAV audio")
    samples = array("h")
    samples.frombytes(frames)
    if sys.byteorder != "little":
        samples.byteswap()
    clipped_count = sum(abs(sample) >= 32500 for sample in samples)
    clipped_fraction = clipped_count / len(samples)
    clipped = clipped_fraction >= SEVERE_CLIPPING_FRACTION
    # Count-in/room silence should not dilute a usable quiet entrance. Require
    # one full 100 ms window; isolated clicks still face note/alignment gates.
    window_bytes = max(1, round(sample_rate * AUDIBLE_WINDOW_SEC)) * channels * sample_width
    audible = any(
        audioop.rms(frames[start:start + window_bytes], sample_width) / 32768.0 >= MIN_AUDIBLE_RMS
        for start in range(0, len(frames) - window_bytes + 1, window_bytes)
    )
    has_dropouts = metadata.missingChunkCount > 0 or (
        metadata.expectedSampleCount is not None and metadata.expectedSampleCount != frame_count
    )
    warnings: list[str] = []
    if clipped:
        warnings.append("clipped")
    elif clipped_fraction >= MINOR_CLIPPING_FRACTION:
        warnings.append("minor_clipping")
    if has_dropouts:
        warnings.append("capture_gap")
    if not audible:
        warnings.append("low_level")
    return {"clipped": clipped, "hasDropouts": has_dropouts, "warnings": warnings}, audible


async def _bounded_form(request: Request) -> tuple[bytes, bytes]:
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
        raise HTTPException(status_code=415, detail="Expected multipart/form-data")
    stated_size = request.headers.get("content-length")
    if stated_size is not None:
        try:
            if int(stated_size) > MAX_BODY_BYTES:
                raise HTTPException(status_code=413, detail="Request exceeds size limit")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid Content-Length") from exc
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Request exceeds size limit")
    raw = bytes(body)
    sent = False

    async def receive() -> Message:
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": raw, "more_body": False}

    parsed = StarletteRequest(request.scope, receive)
    try:
        async with parsed.form(max_files=1, max_fields=1, max_part_size=4096) as form:
            if set(form.keys()) != {"audio", "metadata"}:
                raise HTTPException(status_code=422, detail="Expected audio and metadata fields")
            upload = form["audio"]
            metadata = form["metadata"]
            if not isinstance(upload, UploadFile) or not isinstance(metadata, str):
                raise HTTPException(status_code=422, detail="Invalid multipart fields")
            return await upload.read(MAX_BODY_BYTES + 1), metadata.encode("utf-8")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid multipart request") from exc


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    global _MODEL_ERROR
    try:
        await asyncio.to_thread(_get_model)
    except Exception:
        _MODEL_ERROR = True
    yield


app = FastAPI(title="Encore Analysis", version="1", lifespan=lifespan)


@app.get("/health")
def health() -> JSONResponse:
    loaded = _MODEL is not None and not _MODEL_ERROR
    return JSONResponse(
        status_code=200 if loaded else 503,
        content={"status": "ok" if loaded else "unavailable", "modelLoaded": loaded,
                 "detectorVersion": DETECTOR_VERSION},
    )


@app.post("/v1/analyze")
async def analyze(request: Request) -> dict[str, Any]:
    wav_bytes, metadata_bytes = await _bounded_form(request)
    try:
        metadata = AttemptMetadata.model_validate_json(metadata_bytes)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="Invalid attempt metadata") from exc
    passage = _passages().get(metadata.passageId)
    if passage is None or passage["version"] != metadata.passageVersion:
        raise HTTPException(status_code=422, detail="Unknown passage ID or version")
    quality, audible = _inspect_wav(wav_bytes, metadata)
    if not audible or quality["clipped"] or quality["hasDropouts"]:
        return score_notes(passage, metadata.attemptId, metadata.attemptTempoBpm, [], quality, DETECTOR_VERSION, audible)
    if not _ADMISSION.acquire(blocking=False):
        raise HTTPException(status_code=503, detail="Analysis busy; retry same attempt ID")
    future = asyncio.get_running_loop().run_in_executor(_EXECUTOR, _predict_admitted, wav_bytes)
    try:
        detected = await asyncio.wait_for(asyncio.shield(future), timeout=60.0)
    except asyncio.TimeoutError:
        result = score_notes(passage, metadata.attemptId, metadata.attemptTempoBpm, [], quality, DETECTOR_VERSION, True)
        result["status"] = "error"
        result["audioQuality"]["warnings"].append("analysis_timeout")
        return result
    except Exception:
        result = score_notes(passage, metadata.attemptId, metadata.attemptTempoBpm, [], quality, DETECTOR_VERSION, True)
        result["status"] = "error"
        result["audioQuality"]["warnings"].append("detector_failed")
        return result
    return score_notes(
        passage, metadata.attemptId, metadata.attemptTempoBpm, detected, quality, DETECTOR_VERSION, audible
    )
