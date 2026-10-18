"""Deterministic, monotonic alignment of detected piano notes to a passage.

Timing constants are demo defaults pending labeled G2 and phone recordings. They
are diagnostic cutoffs, not a universal musical grade.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import ceil, isfinite
from statistics import median
from typing import Any

SCORING_VERSION = "1.4.0-demo"
MAX_ANALYSIS_ITEMS = 500
MIN_PITCH_ANCHOR_FRACTION = 0.35
MIN_PAIR_COVERAGE = 0.60
MIN_EXTRA_NOTE_SCORE = 0.35
FINDING_PRIORITY = {"missing_note": 0, "extra_note": 1, "wrong_note": 2, "timing": 3, "duration": 4}
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


def _align(reference: list[dict[str, Any]], detected: list[dict[str, Any]], offset: float, beat_sec: float,
           sequence_only: bool = False, rhythm_only: bool = False) -> Pairing:
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
                if sequence_only:
                    pair_cost = float(reference[i - 1]["midiPitch"] != detected[j - 1]["midiPitch"])
                else:
                    pair_cost = _pair_cost(reference[i - 1], detected[j - 1], offset, beat_sec)
                    if rhythm_only and abs(detected[j - 1]["onsetSec"] -
                                           (reference[i - 1]["onsetBeat"] * beat_sec + offset)) > 0.35 * beat_sec:
                        pair_cost = None
                    if rhythm_only and pair_cost is not None:
                        pair_cost = 0.7 * abs(detected[j - 1]["onsetSec"] -
                                              (reference[i - 1]["onsetBeat"] * beat_sec + offset)) / beat_sec
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
            candidates.add(round(offset, 3))
    return sorted(candidates)


def _matching_beats(reference: list[dict[str, Any]], detected: list[dict[str, Any]], target_beat: float) -> list[float]:
    """Allow a clearly recognizable phrase to be matched at its performed speed.

    This changes correspondence only. Findings still use the requested tempo and
    the first played-note offset, so slow/fast playing remains a timing error.
    """
    sequence = _align(reference, detected, 0, target_beat, sequence_only=True)
    anchors = [(reference[i]["onsetBeat"], detected[j]["onsetSec"]) for i, j in sequence.pairs
               if reference[i]["midiPitch"] == detected[j]["midiPitch"]]
    # Require stronger phrase evidence for tempo adaptation than ordinary grading.
    if (len(anchors) < max(3, ceil(len(reference) * 0.60))
            or len(anchors) < ceil(len(detected) * 0.40)
            or len(sequence.pairs) < ceil(len(reference) * 0.80)):
        return [target_beat]
    slopes = [(later_sec - earlier_sec) / (later_beat - earlier_beat)
              for earlier_beat, earlier_sec in anchors for later_beat, later_sec in anchors
              if later_beat - earlier_beat >= 1 and later_sec > earlier_sec]
    if not slopes:
        return [target_beat]
    performed_beat = median(slopes)
    if not 0.5 * target_beat <= performed_beat <= 2.0 * target_beat:
        return [target_beat]
    entrance = median(onset - beat * performed_beat for beat, onset in anchors)
    residual = median(abs(onset - (beat * performed_beat + entrance)) for beat, onset in anchors)
    if residual > max(0.12, performed_beat * 0.20) or abs(performed_beat / target_beat - 1) < 0.08:
        return [target_beat]
    return [target_beat, performed_beat]


def _rhythmic_fallback(reference: list[dict[str, Any]], detected: list[dict[str, Any]],
                       beat_sec: float, minimum_score: float = 0.5) -> tuple[float, Pairing] | None:
    """Match clear attacks by elapsed beats when pitch identity cannot anchor them.

    Use the first strong attack as the entrance. Weak/harmonic events cannot
    establish correspondence, and a recording spanning multiple takes is rejected.
    """
    strong = [(j, note) for j, note in enumerate(detected)
              if note.get("detectorScore", 0) >= minimum_score and note.get("durationSec", 0) >= 0.18
              and (note.get("detectorScore", 0) >= 0.55 or
                   min(n["midiPitch"] for n in reference) - 24 <= note["midiPitch"]
                   <= max(n["midiPitch"] for n in reference) + 24)]
    if len(strong) < max(3, ceil(len(reference) * 0.375)):
        return None
    # Keep lower-pitched fundamentals when a simultaneous octave is also detected.
    attacks = [(j, note) for j, note in strong if not any(
        other["midiPitch"] < note["midiPitch"]
        and (note["midiPitch"] - other["midiPitch"]) in (12, 19, 24, 28, 31, 36)
        and abs(other["onsetSec"] - note["onsetSec"]) < 0.08
        for _, other in strong)]
    if len(attacks) < 3:
        return None
    offset = attacks[0][1]["onsetSec"] - reference[0]["onsetBeat"] * beat_sec
    span = attacks[-1][1]["onsetSec"] - attacks[0][1]["onsetSec"]
    expected_span = (reference[-1]["onsetBeat"] - reference[0]["onsetBeat"]) * beat_sec
    if span < expected_span * 0.60 or span > expected_span + 3 * beat_sec:
        return None
    candidate = _align(reference, [note for _, note in attacks], offset, beat_sec, rhythm_only=True)
    if len(candidate.pairs) < max(3, ceil(len(reference) * 0.375)):
        return None
    pairs = tuple((i, attacks[j][0]) for i, j in candidate.pairs)
    # All inferred attacks must have a plausible single-note beat location.
    if any(abs(detected[j]["onsetSec"] - (reference[i]["onsetBeat"] * beat_sec + offset))
           > 0.35 * beat_sec for i, j in pairs):
        return None
    return offset, Pairing(candidate.cost, pairs)


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
    if len(detected_notes) > MAX_ANALYSIS_ITEMS:
        result = _base_result(passage, attempt_id, tempo_bpm, [], audio_quality, detector_version)
        result["audioQuality"]["warnings"].append("too_many_note_events")
        return result
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
    candidates = [(offset, matching_beat) for matching_beat in _matching_beats(reference, detected, beat_sec)
                  for offset in _candidate_offsets(reference, detected, matching_beat)]
    def pitch_alignment() -> tuple[float, float, Pairing] | None:
        if not candidates:
            result["audioQuality"]["warnings"].append("no_pitch_anchor")
            return None
        ranked = sorted(
            ((offset, matching_beat, _align(reference, detected, offset, matching_beat))
             for offset, matching_beat in candidates),
            key=lambda item: (item[2].cost, -len(item[2].pairs), abs(item[1] - beat_sec), abs(item[0])),
        )
        offset, matching_beat, best = ranked[0]
        ambiguous = any(
            other.pairs != best.pairs
            and (abs(other_offset - offset) >= MIN_OFFSET_SEPARATION_BEATS * beat_sec
                 or abs(other_beat - matching_beat) >= 0.08 * beat_sec)
            and other.cost - best.cost <= AMBIGUITY_COST_MARGIN
            for other_offset, other_beat, other in ranked[1:]
        )
        pitch_anchors = sum(
            reference[i]["midiPitch"] == detected[j]["midiPitch"] for i, j in best.pairs
        )
        enough_coverage = len(best.pairs) >= ceil(len(reference) * MIN_PAIR_COVERAGE)
        if ambiguous or not enough_coverage or pitch_anchors < max(2, ceil(len(reference) * MIN_PITCH_ANCHOR_FRACTION)):
            result["audioQuality"]["warnings"].append("ambiguous_alignment" if ambiguous else "too_few_pitch_anchors")
            return None
        # Infer note identity before anchoring: a missed opening note or a leading
        # extra must not shift every later reference note. Keep the original WAV clock.
        first_reference, first_detected = best.pairs[0]
        offset = detected[first_detected]["onsetSec"] - reference[first_reference]["onsetBeat"] * beat_sec
        matching_offset = detected[first_detected]["onsetSec"] - reference[first_reference]["onsetBeat"] * matching_beat
        best = _align(reference, detected, matching_offset, matching_beat)
        pitch_anchors = sum(reference[i]["midiPitch"] == detected[j]["midiPitch"] for i, j in best.pairs)
        if (len(best.pairs) < ceil(len(reference) * MIN_PAIR_COVERAGE)
                or pitch_anchors < max(2, ceil(len(reference) * MIN_PITCH_ANCHOR_FRACTION))):
            result["audioQuality"]["warnings"].append("too_few_pitch_anchors")
            return None
        return offset, matching_beat, best

    selected_alignment = pitch_alignment()
    rhythmic = False
    if selected_alignment is None:
        fallback = (_rhythmic_fallback(reference, detected, beat_sec)
                    or _rhythmic_fallback(reference, detected, beat_sec, minimum_score=0.4))
        if fallback is None:
            return result
        offset, best = fallback
        matching_beat = beat_sec
        rhythmic = True
        result["audioQuality"]["warnings"] = [warning for warning in result["audioQuality"]["warnings"]
            if warning not in ("no_pitch_anchor", "too_few_pitch_anchors", "ambiguous_alignment")]
        result["audioQuality"]["warnings"].append("rhythm_anchored_comparison")
    else:
        offset, matching_beat, best = selected_alignment
    result["alignment"] = {"offsetSec": offset, "reliable": True}
    if abs(matching_beat / beat_sec - 1) >= 0.08:
        result["audioQuality"]["warnings"].append("tempo_adjusted_matching")
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
        if not rhythmic:
            errors_ms.append(abs(delta_ms))
        if not rhythmic and abs(delta_ms) > TIMING_FINDING_SEC * 1000.0:
            findings.append({
                "kind": "timing",
                "referenceNoteId": expected["id"],
                "detectedNoteId": played["id"],
                "timingDeltaMs": round(delta_ms, 1),
            })
        if rhythmic:
            continue
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
            if rhythmic:
                # Unpaired detector fragments are not proven extra key strikes.
                continue
            # A short event between aligned repeats may be a detector split or
            # a real quick strike. Keep it visible and withhold musical claims.
            duration = played.get("durationSec")
            if (isinstance(duration, (int, float)) and isfinite(duration)
                    and 0 < duration <= 0.20 and 0 < j < len(detected) - 1
                    and j - 1 in matched_detected and j + 1 in matched_detected
                    and detected[j - 1]["midiPitch"] == played["midiPitch"]
                    == detected[j + 1]["midiPitch"]
                    and detected[j - 1]["onsetSec"] + detected[j - 1]["durationSec"]
                    >= played["onsetSec"] - 0.03
                    and detected[j + 1]["onsetSec"] <= played["onsetSec"] + duration + 0.03):
                if "ambiguous_repeat_boundary" not in result["audioQuality"]["warnings"]:
                    result["audioQuality"]["warnings"].append("ambiguous_repeat_boundary")
                continue
            score = played.get("detectorScore")
            if isinstance(score, (int, float)) and isfinite(score) and score < MIN_EXTRA_NOTE_SCORE:
                # A more sensitive detector also hears faint room hum. Keep raw
                # events in History, but don't call weak unmatched events mistakes.
                if "weak_extra_note_evidence" not in result["audioQuality"]["warnings"]:
                    result["audioQuality"]["warnings"].append("weak_extra_note_evidence")
                continue
            findings.append({"kind": "extra_note", "detectedNoteId": played["id"]})
    if "ambiguous_repeat_boundary" in result["audioQuality"]["warnings"]:
        result["status"] = "uncertain"
        result["alignment"] = {"offsetSec": None, "reliable": False}
        return result
    def importance(finding: dict[str, Any]) -> tuple[int, float]:
        magnitude = abs(finding.get("timingDeltaMs", finding.get("durationDeltaMs", 0)))
        return FINDING_PRIORITY[finding["kind"]], -magnitude

    # Keep every supported finding for phone review and saved History. Glasses
    # apply their own presentation limit without discarding this evidence.
    if len(findings) > MAX_ANALYSIS_ITEMS:
        result["status"] = "uncertain"
        result["alignment"] = {"offsetSec": None, "reliable": False}
        result["audioQuality"]["warnings"].append("too_many_findings")
        return result
    selected = sorted(findings, key=importance)
    result["findings"] = [{"id": f"f{index}", **finding} for index, finding in enumerate(selected, 1)]
    result["metrics"] = {
        "matchedNotes": correct_pitch_count,
        "expectedNotes": len(reference),
        "medianAbsTimingErrorMs": round(median(errors_ms), 1) if errors_ms else None,
    }
    return result
