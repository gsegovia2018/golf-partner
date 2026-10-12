"""python3 -m unittest test_import_export   (run from tools/swing-lab)"""
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

import import_export as ie

META = {
    "schema": "swing-export/1",
    "swing": {"id": "1a2b3c4d-0000", "createdAt": "2026-10-11T16:42:00.000Z", "name": "Sat 11 Oct"},
    "handedness": "right",
    "heightCm": 176,
    "video": {"width": 400, "height": 800, "frameCount": 900, "containerFps": 30, "captureFps": 240},
}
ANALYSIS = {
    "schema": "swing-analysis/1",
    "fps": {"capture": 240, "effective": 240, "factor": 8, "approximate": False},
    "checkpoints": {"address": {"i": 100, "conf": 0.9}, "impact": {"i": 557, "conf": 0.9}},
    "clubMarks": {
        "address": {"hands": [0.5, 0.25], "head": [0.6, 0.5], "hidden": False},
        "impact": {"hands": [0.4, 0.5], "head": None, "hidden": True},
    },
    "reference": {"ball": [0.5, 0.75]},
}
MARKS = {
    "schema": "swing-club-labels/1",
    "ball": {"proposed": [0.5, 0.75], "final": [0.55, 0.75], "corrected": True},
    "frames": [{
        "i": 560, "checkpoint": "impact", "corrected": True,
        "hands": {"final": [0.45, 0.5]},
        "head": {"final": [0.7, 0.9], "finalHidden": False},
    }],
}


def make_zip(path):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        z.writestr("swing.json", json.dumps(META))
        z.writestr("analysis.json", json.dumps(ANALYSIS))
        z.writestr("marks.json", json.dumps(MARKS))
        z.writestr("video.mp4", b"VIDEO")


class ImportExportTest(unittest.TestCase):
    def test_truth_applies_marks_over_the_analysis(self):
        t = ie.build_truth(META, ANALYSIS, MARKS, "c")
        self.assertEqual(t["video"], {"w": 400, "h": 800, "frames": 900, "playbackFps": 30,
                                      "captureFps": 240, "slowmoFactor": 8, "interpolated": False})
        self.assertEqual(t["handedness"], "right")
        self.assertEqual(t["heightCm"], 176)
        self.assertEqual(t["ball"], {"x": 220.0, "y": 600.0, "conf": 1})
        a = t["checkpoints"]["address"]  # untouched: the analysis' own mark
        self.assertEqual((a["frame"], a["hands"], a["head"], a["hidden"]),
                         (100, {"x": 200.0, "y": 200.0}, {"x": 240.0, "y": 400.0}, False))
        i = t["checkpoints"]["impact"]  # corrected: frame, hands, head and hidden from marks.json
        self.assertEqual((i["frame"], i["hands"], i["head"], i["hidden"], i["conf"]),
                         (560, {"x": 180.0, "y": 400.0}, {"x": 280.0, "y": 720.0}, False, 1))
        self.assertNotIn("takeaway", t["checkpoints"])

    def test_club_is_carried_through_and_defaults_to_iron(self):
        self.assertEqual(ie.build_truth(META, ANALYSIS, MARKS, "c")["club"], "iron")  # export from before the picker
        self.assertEqual(ie.build_truth({**META, "club": "driver"}, ANALYSIS, MARKS, "c")["club"], "driver")
        self.assertEqual(ie.build_truth({**META, "swing": {**META["swing"], "club": "driver"}}, ANALYSIS, MARKS, "c")["club"], "driver")
        self.assertEqual(ie.build_truth(META, {**ANALYSIS, "club": "driver"}, MARKS, "c")["club"], "driver")
        self.assertEqual(ie.build_truth({**META, "club": "wood"}, ANALYSIS, MARKS, "c")["club"], "iron")

    def test_hidden_clubhead_has_no_head_point(self):
        t = ie.build_truth(META, ANALYSIS, {"frames": []}, "c")
        self.assertTrue(t["checkpoints"]["impact"]["hidden"])
        self.assertIsNone(t["checkpoints"]["impact"]["head"])

    def test_zip_roundtrip_writes_clip_and_truth(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "x.swing.zip"
            make_zip(src)
            lab = Path(tmp) / "lab"
            clip, _ = ie.import_export(src, lab)
            self.assertEqual(clip, "swing-2026-10-11-1a2b3c4d")
            self.assertEqual((lab / "clips" / f"{clip}.mp4").read_bytes(), b"VIDEO")
            truth = json.loads((lab / "out" / clip / "truth.json").read_text())
            self.assertEqual(truth["source"], "manual")
            self.assertEqual(truth["checkpoints"]["impact"]["frame"], 560)

    def test_rejects_other_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "bad.zip"
            with zipfile.ZipFile(src, "w") as z:
                z.writestr("swing.json", json.dumps({"schema": "nope"}))
                z.writestr("analysis.json", "{}")
                z.writestr("marks.json", "{}")
                z.writestr("video.mp4", b"")
            with self.assertRaises(ValueError):
                ie.import_export(src, Path(tmp) / "lab")


if __name__ == "__main__":
    unittest.main()
