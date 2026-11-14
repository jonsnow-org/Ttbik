"""A cn trainer's output must reach the merge even when Kaggle uploads fail (inventory 2026-11-14: no dataset sham-crawl-ms1 although that trainer finished a cycle
11% better than its start point). The ModelScope private model repo is the second door. Own interpreter: importing sham_inputs installs the VQ patch."""
import pathlib
import subprocess
import sys
import unittest

HEAD = r'''
import os, pathlib, sys, tempfile, types, json
sys.path.insert(0, sys.argv[1])
os.environ["MODELSCOPE_TOKEN"] = "test-token-not-real"
os.environ["SHAM_MS_OWNER"] = "acct"
'''

PUBLISH = HEAD + r'''
os.environ["SHAM_HEAD_SOURCE"] = "modelscope"
pushed = {}
class Api:
    def login(self, tok): pass
    def push_model(self, model_id, model_dir, **kw):
        pushed["id"] = model_id
        pushed["files"] = sorted(p.name for p in pathlib.Path(model_dir).iterdir())
        pushed["private"] = str(kw.get("visibility"))
hub = types.ModuleType("modelscope.hub"); api_mod = types.ModuleType("modelscope.hub.api"); api_mod.HubApi = Api
const = types.ModuleType("modelscope.hub.constants")
class V: PRIVATE = "private"
const.Visibility = V
for n, m in (("modelscope", types.ModuleType("modelscope")), ("modelscope.hub", hub), ("modelscope.hub.api", api_mod), ("modelscope.hub.constants", const)):
    sys.modules[n] = m
import sham_inputs
tmp = pathlib.Path(tempfile.mkdtemp())
(tmp / "final.pt").write_bytes(b"weights"); (tmp / "sham_small_tokenizer.json").write_text("{}")
sham_inputs._publish_kaggle = lambda *a, **k: None          # Kaggle fails (as from cn)
got = sham_inputs.publish_dataset(tmp, "sham-crawl-ms1", "live session")
print("RESULT", got)
print("PUSHED", pushed)
# corpora go to Kaggle only
sham_inputs._publish_kaggle = lambda *a, **k: "acct/sham-crawl-ms1-corpus"
pushed.clear()
print("CORPUS", sham_inputs.publish_dataset(tmp, "sham-crawl-ms1-corpus", "m"), pushed)
# Kaggle ok: the Kaggle slug is the answer, ModelScope still holds the copy
sham_inputs._publish_kaggle = lambda *a, **k: "acct/sham-crawl-ms1"
print("BOTH", sham_inputs.publish_dataset(tmp, "sham-crawl-ms1", "m"), pushed.get("id"))
'''

DISCOVER = HEAD + r'''
src = pathlib.Path(tempfile.mkdtemp()) / "repo"; src.mkdir()
(src / "final.pt").write_bytes(b"w"); (src / "sham_small_tokenizer.json").write_text("{}"); (src / "configuration.json").write_text("{}")
class Api:
    def login(self, tok): pass
    def list_models(self, owner, page_number=1, page_size=50, token=None):
        if page_number > 1: return {"Models": []}
        return {"Models": [{"Name": "sham-crawl-ms1"}, {"Name": "sham-merged"}, {"Name": "sham-crawl-ms1-corpus"}, {"Name": "other"}]}
hub = types.ModuleType("modelscope.hub"); api_mod = types.ModuleType("modelscope.hub.api"); api_mod.HubApi = Api
ms = types.ModuleType("modelscope"); ms.snapshot_download = lambda repo_id, cache_dir=None, **k: str(src)
for n, m in (("modelscope", ms), ("modelscope.hub", hub), ("modelscope.hub.api", api_mod)):
    sys.modules[n] = m
import sham_inputs
print("REPOS", sham_inputs.ms_model_repos())
# the merge's discovery lists it even though Kaggle does not hold it
sham_inputs._ensure_credentials = lambda: "acct"
sham_inputs.subprocess.run = lambda *a, **k: subprocess_result
'''.replace("subprocess_result", "types.SimpleNamespace(stdout='ref,title\\n', stderr='', returncode=0)") + r'''
sham_inputs.shutil.which = lambda name: "/bin/true"
print("CRAWL", sham_inputs.crawl_dataset_names())
# and the fetch falls back to the ModelScope repo when Kaggle says the dataset does not exist
sham_inputs.FETCH_ROOT = pathlib.Path(tempfile.mkdtemp()) / "fetch"
sham_inputs._kaggle = lambda cmd, tries=6: types.SimpleNamespace(args=cmd, returncode=1, stdout="", stderr="404 Not Found")
d = sham_inputs.fetch_dataset("sham-crawl-ms1")
print("FETCHED", None if d is None else sorted(p.name for p in d.iterdir()))
'''

FALLBACK = HEAD + r'''
os.environ["SHAM_HEAD_SOURCE"] = "modelscope"
log = []
mode = {"v": "first-fails"}
class Api:
    def login(self, tok): pass
    def create_model(self, model_id, **kw): log.append(("create", kw.get("license"), kw.get("chinese_name")))
    def push_model(self, model_id, model_dir, **kw):
        log.append(("push", kw.get("license"), kw.get("chinese_name")))
        if mode["v"] == "all-fail" or kw.get("license") == "apache-2.0":
            raise RuntimeError("400 Client Error: Bad Request body {\"Message\": \"invalid license\"}")
hub = types.ModuleType("modelscope.hub"); api_mod = types.ModuleType("modelscope.hub.api"); api_mod.HubApi = Api
const = types.ModuleType("modelscope.hub.constants")
class V: PRIVATE = "private"
const.Visibility = V
for n, m in (("modelscope", types.ModuleType("modelscope")), ("modelscope.hub", hub), ("modelscope.hub.api", api_mod), ("modelscope.hub.constants", const)):
    sys.modules[n] = m
import sham_inputs
tmp = pathlib.Path(tempfile.mkdtemp())
(tmp / "final.pt").write_bytes(b"w")
print("FIRST", sham_inputs.publish_modelscope(tmp, "sham-crawl-ms1", "m"), log)
log.clear(); mode["v"] = "all-fail"
print("SECOND", sham_inputs.publish_modelscope(tmp, "sham-crawl-ms1", "m"))
'''


def run(code: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-c", code, str(pathlib.Path(__file__).parent)], capture_output=True, text=True, timeout=180)


class MsPublish(unittest.TestCase):
    def test_publish_goes_to_modelscope_when_kaggle_fails_and_corpora_stay_on_kaggle(self):
        r = run(PUBLISH)
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        self.assertIn("RESULT modelscope:acct/sham-crawl-ms1", r.stdout)
        self.assertIn("'id': 'acct/sham-crawl-ms1'", r.stdout)
        self.assertIn("configuration.json", r.stdout)
        self.assertIn("final.pt", r.stdout)
        self.assertNotIn("dataset-metadata", r.stdout)
        self.assertIn("'private': 'private'", r.stdout)
        self.assertIn("CORPUS acct/sham-crawl-ms1-corpus {}", r.stdout)           # the corpus never went to ModelScope
        self.assertIn("BOTH acct/sham-crawl-ms1 acct/sham-crawl-ms1", r.stdout)

    def test_the_merge_discovers_and_fetches_a_source_that_only_exists_on_modelscope(self):
        r = run(DISCOVER)
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        self.assertIn("REPOS ['sham-crawl-ms1', 'sham-crawl-ms1-corpus']", r.stdout)
        self.assertIn("'models': ['sham-crawl-ms1']", r.stdout)                    # discovered although Kaggle returned an empty list
        self.assertIn("FETCHED ['final.pt', 'sham_small_tokenizer.json']", r.stdout)   # configuration.json is not part of the dataset layout


class MsCreateFallback(unittest.TestCase):
    def test_a_rejected_create_is_retried_with_the_other_license_spelling_and_the_error_is_kept(self):
        r = run(FALLBACK)
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        self.assertIn("FIRST modelscope:acct/sham-crawl-ms1", r.stdout)
        self.assertIn("('create', 'Apache License 2.0', 'Sham')", r.stdout)
        self.assertIn("SECOND None", r.stdout)
        self.assertIn("invalid license", r.stdout)                                    # the hub's own message reaches the log (it was cut off at 160 characters)
        self.assertIn("push_model[apache-2.0]", r.stdout)
        self.assertIn("push_model[Apache License 2.0]", r.stdout)


if __name__ == "__main__":
    unittest.main()
