"""Per-session computer-bank tests: persistence, search, links, files and isolation."""
from __future__ import annotations

import tempfile
import unittest
import sys
from pathlib import Path

MEDIA_DIR = Path(__file__).resolve().parents[1] / "modelscope-media"
if str(MEDIA_DIR) not in sys.path:
    sys.path.insert(0, str(MEDIA_DIR))
from computer_banks import DEFAULT_BANKS, run_bank_action


class ComputerBanks(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.homes = {
            "alice:nova": self.tmp / "alice" / "home",
            "bob:sham": self.tmp / "bob" / "home",
        }
        for home in self.homes.values():
            home.mkdir(parents=True)
        self.session = "alice:nova"
        self.home = self.homes[self.session]
        self.source = self.home / "project.md"
        self.source.write_text("# Sham project\nThis document describes the memory bank network.\n", encoding="utf-8")

    def call(self, action, **kwargs):
        return run_bank_action(
            self.session, {"bank_action": action, **kwargs},
            home=self.home,
            safe_path=lambda p: (self.home / p).resolve(),
            over_quota=lambda: False,
        )

    def test_bootstraps_logical_banks_without_a_fixed_bank_count(self):
        banks = self.call("list")
        self.assertEqual(banks["bank_count"], len(DEFAULT_BANKS))
        for i in range(30):
            result = self.call("create", bank=f"custom_{i}", description=f"bank {i}")
            self.assertTrue(result["ok"], result)
        result = self.call("list")
        self.assertEqual(result["bank_count"], len(DEFAULT_BANKS) + 30)

    def test_text_put_read_search_and_persistence_after_reopen(self):
        self.assertTrue(self.call("put", bank="projects", key="sham-memory", title="Sham memory", content="Palmyra uses episodic banks and key-value cache for old conversations.")["ok"])
        found = self.call("search", bank="", query="episodic conversations")
        self.assertTrue(found["hits"], found)
        self.assertEqual(found["hits"][0]["key"], "sham-memory")
        again = self.call("read", bank="projects", key="sham-memory")
        self.assertIn("Palmyra", again["entry"]["content"])
        # A new connection sees the exact same durable catalog and data.
        reopened = self.call("read", bank="projects", key="sham-memory")
        self.assertEqual(reopened["entry"]["content"], again["entry"]["content"])

    def test_import_file_and_cross_bank_links(self):
        imported = self.call("import", bank="documents", key="project-plan", source_path="project.md", title="Project plan")
        self.assertTrue(imported["ok"], imported)
        self.assertTrue((self.home / imported["path"]).is_file())
        self.assertTrue(self.call("put", bank="projects", key="implementation", content="Computer storage banks implementation.")["ok"])
        linked = self.call("link", bank="documents", key="project-plan", target_bank="projects", target_key="implementation", relation="implements")
        self.assertTrue(linked["ok"], linked)
        links = self.call("links", bank="documents", key="project-plan")
        self.assertEqual(links["links"][0]["relation"], "implements")
        read = self.call("read", bank="documents", key="project-plan")
        self.assertIn("memory bank network", read["entry"]["text_excerpt"])

    def test_user_and_model_banks_are_not_shared(self):
        self.call("put", bank="projects", key="private", content="Alice's private project detail.")
        other_home = self.homes["bob:sham"]
        other = run_bank_action(
            "bob:sham", {"bank_action": "search", "query": "private project detail"},
            home=other_home, safe_path=lambda p: other_home / p, over_quota=lambda: False,
        )
        self.assertEqual(other["hits"], [])
        self.assertEqual(other["bank_count"] if "bank_count" in other else 0, 0)

    def test_rejects_paths_outside_the_session_home_and_oversized_text(self):
        bad = run_bank_action(
            self.session, {"bank_action": "import", "bank": "documents", "source_path": "../../outside"},
            home=self.home, safe_path=lambda p: (self.home / p).resolve(), over_quota=lambda: False,
        )
        self.assertFalse(bad["ok"])
        large = self.call("put", bank="documents", key="huge", content="x" * (1_000_001))
        self.assertFalse(large["ok"])
        self.assertIn("1 MB", large["error"])


if __name__ == "__main__":
    unittest.main()
