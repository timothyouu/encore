"""Deterministic, monotonic alignment of detected piano notes to a passage.

Timing constants are demo defaults pending labeled G2 and phone recordings. They
are diagnostic cutoffs, not a universal musical grade.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import ceil, isfinite
from statistics import median
from typing import Any

SCORING_VERSION = "1.1.0-demo"
TIMING_FINDING_SEC = 0.15
# Provisional event-duration thresholds, not calibrated acoustic sustain measurements.
DURATION_MIN_SCORE = 0.5
DURATION_ABSOLUTE_SEC = 0.20
DURATION_RELATIVE = 0.25
MAX_PAIR_BEATS = 0.55
MIN_OFFSET_SEPARATION_BEATS = 0.20
AMBIGUITY_COST_MARGIN = 0.30
SKIP_COST = 1.0


@dataclass(frozen=True)
class Pairing:
    cost: float
    pairs: tuple[tuple[int, int], ...]


def _pair_cost(reference: dict[str, Any], detected: dict[str, Any], offset: float, beat_sec: float) -> float | None:
    delta = detected["onsetSec"] - (reference["onsetBeat"] * beat_sec + offset)
    if abs(delta) > MAX_PAIR_BEATS * beat_sec:
        return None
    pitch_cost = 0.0 if reference["midiPitch"] == detected["midiPitch"] else 1.0
    return pitch_cost + 0.7 * abs(delta) / beat_sec


def _align(reference: list[dict[str, Any]], detected: list[dict[str, Any]], offset: float, beat_sec: float) -> Pairing:
    rows = len(reference) + 1
    cols = len(detected) + 1
    costs = [[float("inf")] * cols for _ in range(rows)]
    paths: list[list[tuple[tuple[int, int], ...]]] = [[()] * cols for _ in range(rows)]
    costs[0][0] = 0.0
    for i in range(rows):
        for j in range(cols):
            if i == 0 and j == 0:
                continue
            options: list[tuple[float, tuple[tuple[int, int], ...], int]] = []
            if i:
                options.append((costs[i - 1][j] + SKIP_COST, paths[i - 1][j], 2))
            if j:
                options.append((costs[i][j - 1] + SKIP_COST, paths[i][j - 1], 1))
            if i and j:
                pair_cost = _pair_cost(reference[i - 1], detected[j - 1], offset, beat_sec)
                if pair_cost is not None:
                    options.append((costs[i - 1][j - 1] + pair_cost, paths[i - 1][j - 1] + ((i - 1, j - 1),), 0))
            cost, path, _ = min(options, key=lambda option: (option[0], option[2]))
            costs[i][j] = cost
            paths[i][j] = path
    return Pairing(costs[-1][-1], paths[-1][-1])


def _candidate_offsets(reference: list[dict[str, Any]], detected: list[dict[str, Any]], beat_sec: float) -> list[float]:
    candidates: set[float] = set()
    for expected in reference:
        for played in detected:
            if expected["midiPitch"] != played["midiPitch"]:
                continue
            offset = played["onsetSec"] - expected["onsetBeat"] * beat_sec
            if -0.25 <= offset <= 10.0:
                candidates.add(round(offset, 3))
    return sorted(candidates)


def _base_result(
    passage: dict[str, Any],
    attempt_id: str,
    tempo_bpm: float,
    detected: list[dict[str, Any]],
    audio_quality: dict[str, Any],
    detector_version: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": "1",
        "attemptId": attempt_id,
        "passageId": passage["id"],
        "passageVersion": passage["version"],
        "attemptTempoBpm": tempo_bpm,
        "status": "uncertain",
        "detectorVersion": detector_version,
        "scoringVersion": SCORING_VERSION,
        "audioQuality": {
            "clipped": audio_quality["clipped"],
            "hasDropouts": audio_quality["hasDropouts"],
            "warnings": list(audio_quality["warnings"]),
        },
        "alignment": {"offsetSec": None, "reliable": False},
        "detectedNotes": detected,
        "findings": [],
        "metrics": {
            "matchedNotes": 0,
            "expectedNotes": len(passage["notes"]),
            "medianAbsTimingErrorMs": None,
        },
    }


def score_notes(
    passage: dict[str, Any],
    attempt_id: str,
    tempo_bpm: float,
    detected_notes: list[dict[str, Any]],
    audio_quality: dict[str, Any],
    detector_version: str = "fixture",
    audible: bool = True,
) -> dict[str, Any]:
    """Return the shared AnalysisResult contract without guessing when alignment is weak."""
    out_of_range = any(not 21 <= note["midiPitch"] <= 108 for note in detected_notes)
    detected = sorted(
        (note for note in detected_notes if 21 <= note["midiPitch"] <= 108),
        key=lambda note: (note["onsetSec"], note["midiPitch"], note["id"]),
    )
    result = _base_result(passage, attempt_id, tempo_bpm, detected, audio_quality, detector_version)
    if out_of_range:
        result["audioQuality"]["warnings"].append("out_of_piano_range")
        return result
    if audio_quality["clipped"] or audio_quality["hasDropouts"]:
        result["audioQuality"]["warnings"].append("quality_gate")
        return result
    if not detected:
        result["status"] = "uncertain" if audible else "insufficient_audio"
        result["audioQuality"]["warnings"].append("no_notes_detected" if audible else "silence")
        return result
    beat_sec = 60.0 / tempo_bpm
    reference = passage["notes"]
    candidates = _candidate_offsets(reference, detected, beat_sec)
    if not candidates:
        result["audioQuality"]["warnings"].append("no_pitch_anchor")
        return result
    ranked = sorted(
        ((offset, _align(reference, detected, offset, beat_sec)) for offset in candidates),
        key=lambda item: (item[1].cost, -len(item[1].pairs), abs(item[0])),
    )
    offset, best = ranked[0]
    ambiguous = any(
        abs(other_offset - offset) >= MIN_OFFSET_SEPARATION_BEATS * beat_sec
        and other.cost - best.cost <= AMBIGUITY_COST_MARGIN
        for other_offset, other in ranked[1:]
    )
    pitch_anchors = sum(
        reference[i]["midiPitch"] == detected[j]["midiPitch"] for i, j in best.pairs
    )
    if ambiguous or pitch_anchors < max(2, ceil(len(reference) * 0.60)):
        result["audioQuality"]["warnings"].append("ambiguous_alignment" if ambiguous else "too_few_pitch_anchors")
        return result
    result["alignment"] = {"offsetSec": offset, "reliable": True}
    result["status"] = "ok"
    matched_detected = {j for _, j in best.pairs}
    findings: list[dict[str, Any]] = []
    errors_ms: list[float] = []
    correct_pitch_count = 0
    for i, expected in enumerate(reference):
        pair = next(((ri, dj) for ri, dj in best.pairs if ri == i), None)
        if pair is None:
            findings.append({"kind": "missing_note", "referenceNoteId": expected["id"]})
            continue
        played = detected[pair[1]]
        if expected["midiPitch"] != played["midiPitch"]:
            findings.append({
                "kind": "wrong_note",
                "referenceNoteId": expected["id"],
                "detectedNoteId": played["id"],
            })
            continue
        correct_pitch_count += 1
        delta_ms = (played["onsetSec"] - expected["onsetBeat"] * beat_sec - offset) * 1000.0
        errors_ms.append(abs(delta_ms))
        if abs(delta_ms) > TIMING_FINDING_SEC * 1000.0:
            findings.append({
                "kind": "timing",
                "referenceNoteId": expected["id"],
                "detectedNoteId": played["id"],
                "timingDeltaMs": round(delta_ms, 1),
            })
        duration = played.get("durationSec")
        confidence = played.get("detectorScore")
        if (not isinstance(duration, (int, float)) or not isfinite(duration) or duration <= 0
                or not isinstance(confidence, (int, float)) or not isfinite(confidence)
                or confidence < DURATION_MIN_SCORE):
            if "duration_evidence_weak" not in result["audioQuality"]["warnings"]:
                result["audioQuality"]["warnings"].append("duration_evidence_weak")
            continue
        expected_duration = expected["durationBeats"] * beat_sec
        duration_delta = duration - expected_duration
        if abs(duration_delta) > max(DURATION_ABSOLUTE_SEC, expected_duration * DURATION_RELATIVE):
            findings.append({
                "kind": "duration",
                "referenceNoteId": expected["id"],
                "detectedNoteId": played["id"],
                "durationDeltaMs": round(duration_delta * 1000.0, 1),
            })
    for j, played in enumerate(detected):
        if j not in matched_detected:
            findings.append({"kind": "extra_note", "detectedNoteId": played["id"]})
    result["findings"] = [{"id": f"f{index}", **finding} for index, finding in enumerate(findings, 1)]
    result["metrics"] = {
        "matchedNotes": correct_pitch_count,
        "expectedNotes": len(reference),
        "medianAbsTimingErrorMs": round(median(errors_ms), 1) if errors_ms else None,
    }
    return result

