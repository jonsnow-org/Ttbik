import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import import_chat_export as I  # noqa: E402


def conv():
    def node(i, parent, role, text, kids=()):
        return {"id": i, "parent": parent, "children": list(kids), "message": {"author": {"role": role}, "content": {"parts": [text]}}}
    m = {"root": {"id": "root", "parent": None, "children": ["a"], "message": None},
         "a": node("a", "root", "user", "ما عاصمة فرنسا؟", ["b"]), "b": node("b", "a", "assistant", "عاصمة فرنسا باريس.", ["c"]),
         "c": node("c", "b", "user", "راسلني على me@example.com", ["d"]), "d": node("d", "c", "assistant", "حسنًا.")}
    return {"mapping": m, "current_node": "d"}


class T(unittest.TestCase):
    def test_pairs_follow_the_current_branch(self):
        self.assertEqual(I.conversation_pairs(conv()), [("ما عاصمة فرنسا؟", "عاصمة فرنسا باريس."), ("راسلني على me@example.com", "حسنًا.")])

    def test_private_data_empty_long_and_duplicates_are_dropped(self):
        pairs = I.conversation_pairs(conv()) + [("ما عاصمة فرنسا؟", "تكرار"), ("", "x"), ("س", "ص" * 5000), ("رقمي 0555 123 4567", "ok ok")]
        out, st = I.clean(pairs)
        self.assertEqual(out, [("ما عاصمة فرنسا؟", "عاصمة فرنسا باريس.")])
        self.assertEqual((st["private"], st["duplicate"], st["empty_or_long"]), (2, 1, 2))

    def test_records_are_marked_as_accepted_by_the_owner(self):
        r = I.to_records([("س", "جواب")], "chatgpt-export")[0]
        self.assertTrue(r["metadata"]["reviewed"]); self.assertEqual(r["metadata"]["verification_status"], "owner_accepted")

    def test_zip_and_cli(self):
        import zipfile
        d = Path(tempfile.mkdtemp()); z = d / "e.zip"
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("conversations.json", json.dumps([conv()]))
        out = d / "o.jsonl"
        self.assertEqual(I.main([str(z), str(out)]), 0)
        self.assertEqual(len(out.read_text(encoding="utf-8").splitlines()), 1)


if __name__ == "__main__":
    unittest.main()
