"""Unit test for the speaker-matching step (no model needed): python -m unittest test_assign_speakers"""
import sys
import types
import unittest

# server.py imports faster_whisper and fastapi at load time; the matching function needs neither.
for name in ("faster_whisper",):
    if name not in sys.modules:
        m = types.ModuleType(name); m.WhisperModel = object; sys.modules[name] = m

from server import assign_speakers  # noqa: E402


class AssignSpeakersTest(unittest.TestCase):
    def test_numbers_speakers_by_first_appearance_and_picks_the_biggest_overlap(self):
        segs = [{"start": 0.0, "end": 3.0}, {"start": 3.0, "end": 6.0}, {"start": 6.0, "end": 9.0}]
        turns = [(0.0, 2.5, "SPEAKER_07"), (2.5, 3.2, "SPEAKER_02"), (3.2, 6.0, "SPEAKER_02"), (6.0, 9.0, "SPEAKER_07")]
        out = assign_speakers(segs, turns)
        self.assertEqual([s["speaker"] for s in out], ["Speaker 1", "Speaker 2", "Speaker 1"])

    def test_a_segment_with_no_matching_turn_stays_unknown(self):
        out = assign_speakers([{"start": 10.0, "end": 12.0}], [(0.0, 5.0, "SPEAKER_00")])
        self.assertNotIn("speaker", out[0])


if __name__ == "__main__":
    unittest.main()
