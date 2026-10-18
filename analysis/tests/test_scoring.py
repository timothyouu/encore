"""Scoring regression tests with known performed events, independent of Basic Pitch."""
from __future__ import annotations

import json
from pathlib import Path
import unittest
from typing import Any

from analysis.scoring import score_notes

PASSAGES = {
    passage["id"]: passage
    for passage in json.loads((Path(__file__).resolve().parents[2] / "shared" / "passages.json").read_text())
}


def performed(passage: dict[str, Any], offset: float = 0.8) -> list[dict[str, Any]]:
    beat_sec = 60 / passage["tempoBpm"]
    return [
        {
            "id": f"d{i + 1}",
            "midiPitch": note["midiPitch"],
            "onsetSec": offset + note["onsetBeat"] * beat_sec,
            "durationSec": note["durationBeats"] * beat_sec * 0.8,
            "detectorScore": 0.8,
        }
        for i, note in enumerate(passage["notes"])
    ]


def quality(clipped: bool = False, gaps: bool = False) -> dict[str, Any]:
    return {"clipped": clipped, "hasDropouts": gaps, "warnings": []}


def scored(passage: dict[str, Any], notes: list[dict[str, Any]], audio_quality: dict[str, Any] | None = None, audible: bool = True) -> dict[str, Any]:
    return score_notes(passage, "attempt-test", passage["tempoBpm"], notes, audio_quality or quality(), audible=audible)


class ScoringTests(unittest.TestCase):
    def test_long_leading_silence_does_not_change_comparison(self) -> None:
        passage = PASSAGES["P01"]
        short = scored(passage, performed(passage, offset=0.8))
        delayed = scored(passage, performed(passage, offset=18.25))
        self.assertEqual(delayed["status"], "ok")
        self.assertEqual(delayed["findings"], short["findings"])
        self.assertEqual(delayed["metrics"], short["metrics"])
        self.assertAlmostEqual(delayed["alignment"]["offsetSec"], 18.25)

    def test_first_matched_note_anchors_timing_instead_of_majority(self) -> None:
        passage = PASSAGES["P01"]
        notes = performed(passage)
        notes[0]["onsetSec"] += 0.20
        result = scored(passage, notes)
        self.assertEqual(result["status"], "ok")
        self.assertAlmostEqual(result["alignment"]["offsetSec"], 1.0)
        self.assertTrue(all(finding["kind"] == "timing" for finding in result["findings"]))
        self.assertEqual(len(result["findings"]), 7)
        self.assertTrue(all(finding["timingDeltaMs"] == -200 for finding in result["findings"]))

    def test_missing_opening_note_is_preserved(self) -> None:
        passage = PASSAGES["P01"]
        result = scored(passage, performed(passage)[1:])
        self.assertEqual(result["status"], "ok")
        self.assertEqual([(f["kind"], f.get("referenceNoteId")) for f in result["findings"]],
                         [("missing_note", "P01-N01")])
        self.assertAlmostEqual(result["alignment"]["offsetSec"], 0.8)

    def test_wrong_first_pitch_still_sets_the_entrance(self) -> None:
        passage = PASSAGES["P01"]
        notes = performed(passage, offset=2.0)
        notes[0]["midiPitch"] = 61
        result = scored(passage, notes)
        self.assertEqual(result["status"], "ok")
        self.assertAlmostEqual(result["alignment"]["offsetSec"], 2.0)
        self.assertEqual([(f["kind"], f.get("referenceNoteId")) for f in result["findings"]],
                         [("wrong_note", "P01-N01")])

    def test_leading_extra_does_not_become_the_timing_anchor(self) -> None:
        passage = PASSAGES["P01"]
        notes = performed(passage)
        notes.insert(0, {"id": "extra", "midiPitch": 90, "onsetSec": 0.1,
                         "durationSec": 0.1, "detectorScore": 0.8})
        result = scored(passage, notes)
        self.assertEqual(result["status"], "ok")
        self.assertAlmostEqual(result["alignment"]["offsetSec"], 0.8)
        self.assertEqual([f["kind"] for f in result["findings"]], ["extra_note"])

    def test_all_findings_saved_with_missing_before_largest_timing_errors(self) -> None:
        passage = {**PASSAGES["P01"], "notes": [
            {**PASSAGES["P01"]["notes"][0], "id": f"n{i}", "midiPitch": 40 + i,
             "onsetBeat": i, "durationBeats": 1} for i in range(40)
        ]}
        notes = performed(passage)
        for index in range(1, 13):
            notes[index]["onsetSec"] += 0.16 + index * 0.01
        notes.pop(30)
        result = scored(passage, notes)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(result["findings"]), 13)
        self.assertEqual(result["findings"][0]["kind"], "missing_note")
        self.assertEqual(result["findings"][0]["referenceNoteId"], "n30")
        self.assertEqual([f["timingDeltaMs"] for f in result["findings"][1:]],
                         [280, 270, 260, 250, 240, 230, 220, 210, 200, 190, 180, 170])
        self.assertEqual(result["metrics"]["matchedNotes"], 39)
        self.assertEqual(result["metrics"]["expectedNotes"], 40)

    def test_clean_passage_with_recording_start_offset(self) -> None:
        passage = PASSAGES["P01"]
        result = scored(passage, performed(passage))
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["findings"], [])
        self.assertEqual(result["metrics"]["matchedNotes"], 8)
        self.assertAlmostEqual(result["alignment"]["offsetSec"], 0.8)
        self.assertEqual(result["metrics"]["medianAbsTimingErrorMs"], 0)

    def test_wrong_note_is_bound_to_correct_reference(self) -> None:
        passage = PASSAGES["P01"]
        notes = performed(passage)
        notes[3]["midiPitch"] = 66
        result = scored(passage, notes)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(
            [(finding["kind"], finding.get("referenceNoteId"), finding.get("detectedNoteId")) for finding in result["findings"]],
            [("wrong_note", "P01-N04", "d4")],
        )

    def test_missing_and_extra_notes_are_distinct(self) -> None:
        passage = PASSAGES["P01"]
        notes = performed(passage)
        notes.pop(3)
        notes.append({"id": "dx", "midiPitch": 72, "onsetSec": 8.6, "durationSec": 0.2})
        result = scored(passage, notes)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(
            [(finding["kind"], finding.get("referenceNoteId"), finding.get("detectedNoteId")) for finding in result["findings"]],
            [("missing_note", "P01-N04", None), ("extra_note", None, "dx")],
        )

    def test_repeated_pitches_are_matched_one_to_one(self) -> None:
        passage = PASSAGES["P02"]
        notes = performed(passage)
        result = scored(passage, notes)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["metrics"]["matchedNotes"], len(notes))
        self.assertEqual(result["findings"], [])

    def test_short_repeat_boundary_event_is_uncertain(self) -> None:
        passage = PASSAGES["P02"]
        notes = performed(passage)
        notes.insert(1, {"id": "fragment", "midiPitch": 64, "onsetSec": 1.66,
                         "durationSec": 0.14, "detectorScore": 0.52})
        notes[0]["durationSec"] = 0.88
        result = scored(passage, notes)
        self.assertEqual(result["status"], "uncertain")
        self.assertEqual(result["findings"], [])
        self.assertFalse(result["alignment"]["reliable"])
        self.assertIn("ambiguous_repeat_boundary", result["audioQuality"]["warnings"])
        self.assertEqual(len(result["detectedNotes"]), 9)

    def test_intentional_quick_repeat_does_not_become_false_correction(self) -> None:
        passage = PASSAGES["P02"]
        notes = performed(passage)
        notes[0]["durationSec"] = 0.88
        notes.insert(1, {"id": "quick-repeat", "midiPitch": 64,
                         "onsetSec": 1.66, "durationSec": 0.14, "detectorScore": 0.8})
        notes[4]["midiPitch"] = 66
        result = scored(passage, notes)
        self.assertEqual(result["status"], "uncertain")
        self.assertEqual(result["findings"], [])
        self.assertIn("ambiguous_repeat_boundary", result["audioQuality"]["warnings"])

    def test_real_short_extra_note_outside_repeat_join_is_reported(self) -> None:
        passage = PASSAGES["P02"]
        notes = performed(passage)
        notes.append({"id": "extra", "midiPitch": 72, "onsetSec": 8.6,
                      "durationSec": 0.12, "detectorScore": 0.8})
        result = scored(passage, notes)
        self.assertEqual([(finding["kind"], finding.get("detectedNoteId"))
                          for finding in result["findings"]], [("extra_note", "extra")])

    def test_late_note_keeps_global_offset(self) -> None:
        passage = PASSAGES["P01"]
        notes = performed(passage)
        notes[3]["onsetSec"] += 0.25
        result = scored(passage, notes)
        self.assertEqual(result["status"], "ok")
        self.assertAlmostEqual(result["alignment"]["offsetSec"], 0.8)
        self.assertEqual(result["findings"][0]["kind"], "timing")
        self.assertEqual(result["findings"][0]["referenceNoteId"], "P01-N04")
        self.assertAlmostEqual(result["findings"][0]["timingDeltaMs"], 250)

    def test_two_note_fragment_is_uncertain(self) -> None:
        passage = PASSAGES["P01"]
        result = scored(passage, performed(passage)[:2])
        self.assertEqual(result["status"], "uncertain")
        self.assertEqual(result["findings"], [])
        self.assertFalse(result["alignment"]["reliable"])

    def test_clear_performance_with_four_wrong_notes_can_get_feedback(self) -> None:
        passage = PASSAGES["P01"]
        notes = performed(passage)
        for index in (1, 3, 5, 7):
            notes[index]["midiPitch"] += 1
        result = scored(passage, notes)
        self.assertEqual(result["status"], "ok")
        self.assertEqual([f["kind"] for f in result["findings"]], ["wrong_note"] * 4)
        self.assertEqual(result["metrics"]["matchedNotes"], 4)

    def test_three_note_fragment_still_cannot_grade_whole_passage(self) -> None:
        passage = PASSAGES["P01"]
        result = scored(passage, performed(passage)[:3])
        self.assertEqual(result["status"], "uncertain")
        self.assertEqual(result["findings"], [])

    def test_weak_room_hum_is_saved_without_an_extra_note_accusation(self) -> None:
        passage = PASSAGES["P01"]
        notes = performed(passage)
        notes.append({"id": "hum", "midiPitch": 31, "onsetSec": 0.2,
                      "durationSec": 0.2, "detectorScore": 0.23})
        result = scored(passage, notes)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["findings"], [])
        self.assertIn("weak_extra_note_evidence", result["audioQuality"]["warnings"])
        self.assertTrue(any(note["id"] == "hum" for note in result["detectedNotes"]))

    def test_rest_and_long_note_passages(self) -> None:
        self.assertEqual(
            [note["onsetBeat"] for note in PASSAGES["P04"]["notes"]],
            [0, 2, 3, 4, 6, 7],
        )
        for passage_id in ("P04", "P05", "P06"):
            with self.subTest(passage_id=passage_id):
                passage = PASSAGES[passage_id]
                result = scored(passage, performed(passage))
                self.assertEqual(result["findings"], [])
                if passage_id == "P04":
                    self.assertNotIn("duration_not_assessed", result["audioQuality"]["warnings"])

    def test_ambiguous_partial_recording_suppresses_findings(self) -> None:
        result = scored(PASSAGES["P01"], [
            {"id": "d1", "midiPitch": 60, "onsetSec": 1.0, "durationSec": 0.5}
        ])
        self.assertEqual(result["status"], "uncertain")
        self.assertFalse(result["alignment"]["reliable"])
        self.assertEqual(result["findings"], [])

    def test_out_of_piano_range_suppresses_invalid_result(self) -> None:
        passage = PASSAGES["P01"]
        notes = performed(passage)
        notes.append({"id": "invalid", "midiPitch": 109, "onsetSec": 8.8, "durationSec": 0.2})
        result = scored(passage, notes)
        self.assertEqual(result["status"], "uncertain")
        self.assertEqual(result["findings"], [])
        self.assertFalse(result["alignment"]["reliable"])
        self.assertIn("out_of_piano_range", result["audioQuality"]["warnings"])
        self.assertTrue(all(21 <= note["midiPitch"] <= 108 for note in result["detectedNotes"]))

    def test_silent_and_audible_without_notes(self) -> None:
        self.assertEqual(scored(PASSAGES["P01"], [], audible=False)["status"], "insufficient_audio")
        result = scored(PASSAGES["P01"], [], audible=True)
        self.assertEqual(result["status"], "uncertain")
        self.assertEqual(result["findings"], [])

    def test_clipped_or_gapped_audio_suppresses_musical_findings(self) -> None:
        notes = performed(PASSAGES["P01"])
        for audio_quality in (quality(clipped=True), quality(gaps=True)):
            with self.subTest(audio_quality=audio_quality):
                result = scored(PASSAGES["P01"], notes, audio_quality)
                self.assertEqual(result["status"], "uncertain")
                self.assertEqual(result["findings"], [])


if __name__ == "__main__":
    unittest.main()
