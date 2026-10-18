"""Acceptance cases independently pin duration evidence and suppression behavior."""
from __future__ import annotations

import unittest
from analysis.tests.test_scoring import PASSAGES, performed, scored, quality


class DurationAcceptance(unittest.TestCase):
    def test_half_note_played_as_quarter(self) -> None:
        passage = PASSAGES["P04"]
        notes = performed(passage)
        notes[0]["durationSec"] = 1.0
        findings = scored(passage, notes)["findings"]
        self.assertEqual(findings, [{"id": "f1", "kind": "duration", "referenceNoteId": "P04-N01", "detectedNoteId": "d1", "durationDeltaMs": -1000.0}])

    def test_quarter_note_played_as_half(self) -> None:
        passage = PASSAGES["P04"]
        notes = performed(passage)
        notes[1]["durationSec"] = 2.0
        finding = scored(passage, notes)["findings"][0]
        self.assertEqual(finding["kind"], "duration")
        self.assertEqual(finding["durationDeltaMs"], 1000.0)
        self.assertNotIn("timingDeltaMs", finding)

    def test_weak_duration_evidence_is_not_a_mistake(self) -> None:
        for confidence in (None, 0.1, float("nan")):
            passage = PASSAGES["P04"]
            notes = performed(passage)
            notes[0]["durationSec"] = 0.2
            notes[0]["detectorScore"] = confidence
            result = scored(passage, notes)
            self.assertEqual(result["findings"], [])
            self.assertIn("duration_evidence_weak", result["audioQuality"]["warnings"])

    def test_wrong_pitch_and_bad_audio_do_not_gain_duration_claims(self) -> None:
        passage = PASSAGES["P01"]
        notes = performed(passage)
        notes[3]["midiPitch"] = 66
        notes[3]["durationSec"] = 5
        self.assertEqual([f["kind"] for f in scored(passage, notes)["findings"]], ["wrong_note"])
        self.assertEqual(scored(passage, notes, quality(clipped=True))["findings"], [])


if __name__ == "__main__":
    unittest.main()