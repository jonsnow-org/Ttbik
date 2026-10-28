import json
import unittest

import studio_inventory as inv


class Pick(unittest.TestCase):
    def test_keeps_only_whitelisted_facts_and_no_text(self):
        st = {"phase": "ready", "mem_available_gb": 2.6, "queue": 1, "token": "SECRET", "active": [{"x": 1}], "messages": "user text",
              "disk": {"total_gb": 8.0, "used_gb": 5.0, "free_gb": 3.0}, "media_assets": {"ready": True, "reason": "x" * 500}}
        out = inv.pick(st)
        self.assertEqual(out["phase"], "ready")
        self.assertEqual(out["disk_gb"]["free_gb"], 3.0)
        self.assertTrue(out["media_assets_ready"])
        self.assertNotIn("SECRET", json.dumps(out))
        self.assertNotIn("messages", out)
        self.assertNotIn("active", out)

    def test_sham_disk_bytes(self):
        out = inv.pick({"disk": {"total_bytes": 8 * 2 ** 30, "used_bytes": 5 * 2 ** 30, "free_bytes": 3 * 2 ** 30}})
        self.assertEqual(out["disk_gb"], {"total_gb": 8.0, "used_gb": 5.0, "free_gb": 3.0})

    def test_long_strings_dropped(self):
        self.assertNotIn("detail", inv.pick({"detail": "y" * 500}))

    def test_known_names_cover_the_repo_studios(self):
        for n in ("nova-media-server", "sham-v1-server", "sham-v2-server", "nova-inference-server", "coder-inference-server-5"):
            self.assertIn(n, inv.KNOWN)


if __name__ == "__main__":
    unittest.main()
