"""Nova 1 / Nova 2 on the T-LDM trainer job: Sham 2's technique, but each on its own.

The contract under test (owner's rule 2026-11-18: independence is a hard condition):
  * `nova_mode` maps a job name to exactly one Nova, and refuses to guess;
  * a Nova cycle fetches ITS OWN donor, trains with ITS OWN config, writes ITS OWN head file in ITS OWN folder,
    publishes to ITS OWN head repo, and never touches the other Nova's files;
  * Nova's benchmark never runs in Sham's embedded computer;
  * the recipe key differs per Nova, so one config change does not invalidate the other's cache.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import app as A  # noqa: E402


REPORT = {
    "train": {"same_effect": 0.9},
    "heldout": {"same_effect": 0.7},
    "heldout2": {"same_effect": 0.65},
    "donor_weights_unchanged": True,
    "writer": [{"heldout": {"same_effect": 0.7}, "heldout2": {"same_effect": 0.65}}],
    "loop": [{"all": {"success": 0.9, "median_s_per_task": 2.0}, "simple": {"success": 0.95}, "multi_step": {"success": 0.8}}],
}


class NovaMode(unittest.TestCase):
    def test_each_prefix_names_its_own_nova_and_others_are_not_nova(self):
        self.assertEqual(A.nova_mode("nova1-live"), "nova1")
        self.assertEqual(A.nova_mode("Nova2-ms1"), "nova2")
        self.assertEqual(A.nova_mode("nova12"), "nova1")          # a Nova 1 job, never Nova 2
        self.assertEqual(A.nova_mode("nova2"), "nova2")
        for other in ("sham2", "sham2-x", "nova", "nova3", "tldm", "", None):
            self.assertEqual(A.nova_mode(other), "", other)

    def test_nova_is_not_sham2_mode(self):
        self.assertFalse(A.sham2_mode("nova1-live"))
        self.assertFalse(A.sham2_mode("nova2-ms1"))


class NovaCycle(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self._env = {k: os.environ.get(k) for k in ("TLDM_WORK",)}
        os.environ["TLDM_WORK"] = str(self.tmp)
        self.fetched, self.cmds, self.published = [], [], []

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def fetch(self, repo, dest):
        self.fetched.append(repo)
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "model.safetensors").write_bytes(b"w")
        (dest / "tokenizer.json").write_text("{}", encoding="utf-8")

    def runner(self, cmd, report, heads):
        self.cmds.append(cmd)
        heads.write_bytes(b"h")
        report.write_text(json.dumps(REPORT), encoding="utf-8")
        return 0

    def publish(self, folder, name, message):
        self.published.append((name, sorted(p.name for p in Path(folder).iterdir())))
        return "modelscope:novaai2026/" + name

    def test_each_nova_has_its_own_donor_config_head_folder_and_repo(self):
        n1 = A.run_nova(name="nova1-x", runner=self.runner, fetch=self.fetch, publish=self.publish)
        n2 = A.run_nova(name="nova2-x", runner=self.runner, fetch=self.fetch, publish=self.publish)
        self.assertEqual(self.fetched, ["Qwen/Qwen3.5-4B", "Qwen/Qwen3.6-35B-A3B"])
        self.assertTrue(self.cmds[0][self.cmds[0].index("--config") + 1].endswith("nova1.yaml"))
        self.assertTrue(self.cmds[1][self.cmds[1].index("--config") + 1].endswith("nova2.yaml"))
        self.assertEqual([p[0] for p in self.published], ["nova1-tldm-head", "nova2-tldm-head"])
        self.assertEqual(self.published[0][1], ["nova1_heads.pt", "nova1_results.json"])
        self.assertEqual(self.published[1][1], ["nova2_heads.pt", "nova2_results.json"])
        self.assertEqual((n1["model"], n2["model"]), ("nova1", "nova2"))
        self.assertTrue(n1["published"] and n2["published"])

    def test_the_two_novas_never_write_into_each_others_folder(self):
        A.run_nova(name="nova1-x", runner=self.runner, fetch=self.fetch, publish=self.publish)
        A.run_nova(name="nova2-x", runner=self.runner, fetch=self.fetch, publish=self.publish)
        self.assertTrue((self.tmp / "nova1" / "nova1_heads.pt").is_file())
        self.assertTrue((self.tmp / "nova2" / "nova2_heads.pt").is_file())
        self.assertFalse((self.tmp / "nova1" / "nova2_heads.pt").exists())
        self.assertFalse((self.tmp / "nova2" / "nova1_heads.pt").exists())

    def test_nova_benchmark_does_not_use_shams_embedded_computer(self):
        A.run_nova(name="nova1-x", runner=self.runner, fetch=self.fetch, publish=self.publish)
        cmd = self.cmds[0]
        self.assertEqual(cmd[cmd.index("--terminal") + 1], "sandbox")
        self.assertIn("--cached", cmd)
        self.assertIn("--loop", cmd)
        self.assertIn("--identity", cmd)

    def test_an_ambiguous_name_is_refused_rather_than_guessed(self):
        with self.assertRaises(RuntimeError) as ctx:
            A.run_nova(name="nova", runner=self.runner, fetch=self.fetch, publish=self.publish)
        self.assertIn("refusing to guess", str(ctx.exception))
        self.assertEqual(self.fetched, [])

    def test_recipe_keys_differ_per_nova(self):
        self.assertNotEqual(A.nova_run_key("nova1"), A.nova_run_key("nova2"))

    def test_a_floor_heldout_head_is_not_published(self):
        def floor(cmd, report, heads):
            self.cmds.append(cmd)
            heads.write_bytes(b"h")
            report.write_text(json.dumps({"train": {"same_effect": 0.07}, "heldout": {"same_effect": 0.083},
                                          "heldout2": {"same_effect": 0.071}}), encoding="utf-8")
            return 0
        out = A.run_nova(name="nova2-x", runner=floor, fetch=self.fetch, publish=self.publish)
        self.assertFalse(out["published"])
        self.assertEqual(self.published, [])
        self.assertFalse((self.tmp / "nova2" / ".published").exists())

    def test_the_configs_exist_and_are_separate_files(self):
        root = A.tldm_root()
        for which in ("nova1", "nova2"):
            cfg = root / A.NOVA_CONFIG[which]
            self.assertTrue(cfg.is_file(), cfg)
            text = cfg.read_text(encoding="utf-8")
            self.assertIn("latents:", text)
            self.assertNotIn("sham2.yaml", text.splitlines()[0])


class DonorIsolation(unittest.TestCase):
    def test_donor_repos_are_distinct_and_never_shams(self):
        self.assertNotEqual(A.NOVA_DONOR_REPO["nova1"], A.NOVA_DONOR_REPO["nova2"])
        self.assertNotEqual(A.NOVA_HEAD_REPO["nova1"], A.NOVA_HEAD_REPO["nova2"])
        for which in ("nova1", "nova2"):
            self.assertNotIn("sham", A.NOVA_DONOR_REPO[which].lower())
            self.assertNotIn("sham", A.NOVA_HEAD_REPO[which].lower())

    def test_a_donor_without_weights_is_an_error_not_a_random_body(self):
        tmp = Path(tempfile.mkdtemp())

        def fetch(repo, dest):
            dest.mkdir(parents=True, exist_ok=True)          # an empty download

        with self.assertRaises(RuntimeError) as ctx:
            A.nova_donor("nova1", tmp, fetch)
        self.assertIn("never train on a random body", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
