"""Regression tests for the per-session file-backed bank network."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "modelscope-media"
sys.path.insert(0, str(SOURCE))
import computer_banks as banks  # noqa: E402


class ComputerBanksTests(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp()).resolve()
        self.home.chmod(0o755)
        self.quota = 64 * 1024 * 1024

    def resolve(self, value):
        return self.home / value

    def run_bank(self, **job):
        return banks.perform(
            self.home, job, quota_bytes=self.quota,
            used_bytes=sum(p.stat().st_size for p in self.home.rglob("*") if p.is_file()),
            path_resolver=self.resolve,
        )

    def test_create_put_search_and_restore_text_with_arabic(self):
        created = self.run_bank(bank_action="create", bank="docs", category="documents",
                                description="Private project documents")
        self.assertTrue(created["ok"], created)
        source = self.home / "guide.md"
        source.write_text("هذا المستند يشرح إعداد الحاسوب وبنوك التخزين والبحث عن الملفات.", encoding="utf-8")
        stored = self.run_bank(bank_action="put", bank="docs", source_path="guide.md",
                               kind="document", metadata={"lang": "ar"})
        self.assertTrue(stored["ok"], stored)
        self.assertGreater(stored["text_indexed_chars"], 0)
        found = self.run_bank(bank_action="search", bank="docs", query="بنوك التخزين")
        self.assertTrue(found["ok"], found)
        self.assertTrue(found["results"], found)
        self.assertEqual(found["results"][0]["item_id"], stored["item_id"])
        restored = self.run_bank(bank_action="get", bank="docs", item_id=stored["item_id"])
        self.assertIn("إعداد الحاسوب", restored["text"])

    def test_binary_objects_can_be_restored_and_identical_bytes_are_deduplicated(self):
        source = self.home / "payload.bin"
        source.write_bytes(os.urandom(8192))
        first = self.run_bank(bank_action="put", bank="workspace", source_path="payload.bin", name="bundle.bin")
        self.assertTrue(first["ok"], first)
        second = self.run_bank(bank_action="put", bank="workspace", source_path="payload.bin", name="bundle.bin")
        self.assertTrue(second["ok"], second)
        self.assertEqual(first["item_id"], second["item_id"])
        self.assertTrue(second["deduplicated"])
        target = self.run_bank(bank_action="get", bank="workspace", item_id=first["item_id"],
                               output_path="restored/bundle.bin")
        self.assertTrue(target["ok"], target)
        self.assertEqual((self.home / "restored" / "bundle.bin").read_bytes(), source.read_bytes())

    def test_same_blob_is_shared_between_topic_banks_and_catalog_is_paginated(self):
        source = self.home / "same.txt"
        source.write_text("one content-addressed object", encoding="utf-8")
        self.run_bank(bank_action="create", bank="one", category="documents")
        self.run_bank(bank_action="create", bank="two", category="datasets")
        a = self.run_bank(bank_action="put", bank="one", source_path="same.txt")
        b = self.run_bank(bank_action="put", bank="two", source_path="same.txt")
        self.assertTrue(a["ok"] and b["ok"])
        self.assertTrue(b["deduplicated"])
        linked = self.run_bank(bank_action="link", bank="one", target_bank="two", relation="references", note="shared dataset")
        self.assertTrue(linked["ok"], linked)
        relations = self.run_bank(bank_action="related", bank="one")
        self.assertEqual(relations["links"][0]["to_bank"], "two")
        cross_search = self.run_bank(bank_action="search", bank="one", include_related=True,
                                     query="content-addressed object", limit=10)
        self.assertEqual({item["bank"] for item in cross_search["results"]}, {"one", "two"})
        stats = self.run_bank(bank_action="stats")
        self.assertEqual(stats["banks"], 3)
        self.assertEqual(stats["items"], 2)
        catalog = self.run_bank(bank_action="list", limit=1, offset=1)
        self.assertEqual(len(catalog["banks"]), 1)
        self.assertEqual(catalog["offset"], 1)

    def test_quota_is_enforced_before_a_new_blob_is_persisted(self):
        source = self.home / "random.bin"
        source.write_bytes(os.urandom(4096))
        out = banks.perform(self.home, {"bank_action": "put", "bank": "workspace",
                                        "source_path": "random.bin"},
                            quota_bytes=64, used_bytes=0, path_resolver=self.resolve)
        self.assertFalse(out["ok"])
        self.assertIn("quota", out["error"])
        objects = self.home / banks.BANK_DIR / "objects"
        self.assertFalse(any(p.is_file() for p in objects.rglob("*")))

    def test_sources_cannot_escape_the_session_or_follow_symlinks(self):
        outside = self.home.parent / "outside-secret.txt"
        outside.write_text("not inside this workspace", encoding="utf-8")
        link = self.home / "escape.txt"
        try:
            link.symlink_to(outside)
        except OSError:
            self.skipTest("symlinks are not available on this test platform")
        out = self.run_bank(bank_action="put", bank="workspace", source_path="escape.txt")
        self.assertFalse(out["ok"])
        self.assertIn("symbolic links", out["error"])
        outside.unlink(missing_ok=True)

    def test_items_and_banks_are_isolated_by_separate_home_roots(self):
        source = self.home / "private.txt"
        source.write_text("session A only", encoding="utf-8")
        stored = self.run_bank(bank_action="put", bank="workspace", source_path="private.txt")
        other_home = Path(tempfile.mkdtemp()).resolve()
        other = banks.perform(other_home, {"bank_action": "list"},
                              quota_bytes=self.quota, used_bytes=0)
        self.assertTrue(stored["ok"])
        self.assertEqual(other["banks"], [])
        self.assertEqual(other["items"], [])


if __name__ == "__main__":
    unittest.main()
