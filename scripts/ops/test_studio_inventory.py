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
        self.assertNotIn("user text", json.dumps(out))

    def test_sham_disk_bytes(self):
        out = inv.pick({"disk": {"total_bytes": 8 * 2 ** 30, "used_bytes": 5 * 2 ** 30, "free_bytes": 3 * 2 ** 30}})
        self.assertEqual(out["disk_gb"], {"total_gb": 8.0, "used_gb": 5.0, "free_gb": 3.0})

    def test_long_strings_dropped(self):
        self.assertNotIn("detail", inv.pick({"detail": "y" * 500}))

    def test_keeps_separate_native_and_runtime_media_capabilities(self):
        out = inv.pick({
            "phase": "ready",
            "media_capabilities": {"vision": True, "audio": True, "video": False},
            "model_native_outputs": {"image": False, "audio": True, "video": False},
            "runtime_generation_capabilities": {"image": False, "audio": False, "video": False},
            "media_assets": {"ready": True, "reason": "private details not copied"},
        })
        self.assertEqual(out["media_capabilities"], {"vision": True, "audio": True, "video": False})
        self.assertTrue(out["model_native_outputs"]["audio"])
        self.assertFalse(out["runtime_generation_capabilities"]["audio"])
        self.assertTrue(out["media_assets"]["ready"])
        self.assertNotIn("reason", json.dumps(out))

    def test_studio_list_url_supports_owner_me_and_pagination(self):
        url = inv.studio_list_url(3, 50, "me")
        self.assertIn("owner=me", url)
        self.assertIn("status=all", url)
        self.assertIn("page_number=3", url)
        self.assertIn("page_size=50", url)

    def test_extract_studio_page_accepts_top_level_and_wrapped_payloads(self):
        items = [{"id": "owner/studio-a"}, {"repo_name": "studio-b"}]
        direct, total, keys = inv.extract_studio_page({"studios": items, "total_count": 2})
        self.assertEqual(direct, items)
        self.assertEqual(total, 2)
        wrapped, total2, _ = inv.extract_studio_page({"data": {"studios": items, "total_count": 2}})
        self.assertEqual(wrapped, items)
        self.assertEqual(total2, 2)

    def test_studio_list_url_requests_all_states_with_supported_pagination(self):
        url = inv.studio_list_url(2, 50)
        self.assertIn("owner=novaai2026", url)
        self.assertIn("status=all", url)
        self.assertIn("page_number=2", url)
        self.assertIn("page_size=50", url)
        self.assertNotIn("page=", url)

    def test_status_sse_and_direct_payload_parsing(self):
        sse = 'data: ["{\\\"phase\\\": \\\"ready\\\"}"]' + chr(10) + chr(10)
        self.assertEqual(inv._decode_sse_status(sse), {"phase": "ready"})
        self.assertEqual(inv._unwrap_direct_status({"data": ['{"phase":"ready"}']}), {"phase": "ready"})

    def test_known_names_cover_candidate_and_specialized_media_studios(self):
        for name in ("sham-donor-qwen35-9b-test", "sham-donor-gemma4-e4b-test",
                     "sham-donor-minicpmo45-test", "sham-v2-video-server",
                     "sham-v2-overflow-server", "nova-media-server"):
            self.assertIn(name, inv.KNOWN)

    def test_known_names_cover_the_repo_studios(self):
        for n in ("nova-media-server", "sham-v1-server", "sham-v2-server", "nova-inference-server", "coder-inference-server-5"):
            self.assertIn(n, inv.KNOWN)


if __name__ == "__main__":
    unittest.main()
