import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

import sham_tldm_serve as S


class Sham2TldmServe(unittest.TestCase):
    def setUp(self):
        os.environ.pop("SHAM_TLDM", None)
        os.environ.pop("SHAM_TLDM_REPO", None)
        os.environ.pop("SHAM_TLDM_CKPT", None)
        S._LOADED.clear()
        S._PENDING.clear()

    def test_off_by_default_and_owner_flag(self):
        self.assertFalse(S.enabled())
        self.assertFalse(S.requested(False))
        self.assertTrue(S.requested(True))
        os.environ["SHAM_TLDM"] = "1"
        self.assertTrue(S.enabled())
        self.assertTrue(S.requested(False))

    def test_missing_head_is_a_clear_error_with_no_sham1_fallback(self):
        msg = S.missing_message()
        self.assertIn("novaai2026/sham2-tldm-head", msg)
        self.assertIn("شام 1", msg)
        self.assertIn("تحويل صامت", msg)
        payload = json.loads(S.error_json(msg))
        self.assertEqual(payload["type"], "error")
        self.assertEqual(payload["fallback"], "none")
        self.assertTrue(payload["tldm"])

    def test_respond_without_a_head_does_not_call_sham1(self):
        os.environ["SHAM_TLDM_CKPT"] = "/tmp/no-such-sham2-head.pt"
        with mock.patch.object(S, "download_head", return_value=None):
            out = json.loads(S.respond(body=None, tok=None, session="s", message="مرحبا"))
        self.assertEqual(out["type"], "error")
        self.assertEqual(out["fallback"], "none")
        self.assertIn("شام 1", out["text"])

    def test_a_hub_hiccup_keeps_the_head_that_is_already_loaded(self):
        """download_head runs on every request; a transient hub error must not switch an already loaded head off (live 2026-11-25)."""
        chat = object()
        S._LOADED.update(path="/cache/sham2_heads.pt", chat=chat)
        with mock.patch.object(S, "download_head", return_value=None):
            self.assertEqual(S.load_chat(None, None), (chat, ""))
        S._LOADED.clear()                                             # nothing loaded yet: the honest "head is not there" error stays
        with mock.patch.object(S, "download_head", return_value=None):
            loaded, err = S.load_chat(None, None)
        self.assertIsNone(loaded)
        self.assertEqual(err, S.missing_message())

    def test_repo_override(self):
        os.environ["SHAM_TLDM_REPO"] = "Jonjithup/sham2-tldm-head"
        self.assertEqual(S.repo_id(), "Jonjithup/sham2-tldm-head")
        self.assertIn("Jonjithup/sham2-tldm-head", S.missing_message())

    def test_local_ckpt_is_preferred_when_the_file_exists(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "head_and_adapters.pt"
            path.write_bytes(b"x")
            os.environ["SHAM_TLDM_CKPT"] = str(path)
            self.assertEqual(S._find_local_head(), path)

    def test_web_tool_request_returns_to_app_and_resumes_the_same_tldm_session(self):
        seen = []
        class Backend:
            def run(self, cmd, confirm=False):
                raise AssertionError("read-only web tools must not execute as shell commands")
        class Chat:
            max_steps = 4
            def backend_factory(self, session):
                return Backend()
            def writer(self, task, hist):
                seen.append(list(hist))
                if any(str(item[0]).startswith("@tool web_search") for item in hist if isinstance(item, (list, tuple)) and item):
                    return "وجدت نتيجة البحث وسأجيب عنها."
                return '$ @tool web_search {"query":"موقع أكواد ضخم"}'
        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            first = json.loads(S.respond(None, None, "tldm-sham_v2-web", "قم بجولة بحث في الإنترنت عن موقع أكواد ضخم"))
        self.assertEqual(first["type"], "tool_request")
        self.assertEqual(first["tool_name"], "web_search")
        self.assertEqual(first["tool_arguments"], {"query": "موقع أكواد ضخم"})
        self.assertEqual(first["session"], "tldm-sham_v2-web")
        self.assertTrue(first["tool_request_id"])
        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            stale = json.loads(S.respond(
                None, None, "tldm-sham_v2-web", "قم بجولة بحث في الإنترنت عن موقع أكواد ضخم",
                resume_tool_name="web_search", resume_tool_arguments_json='{"query":"different"}',
                resume_tool_result="not allowed", resume_tool_request_id=first["tool_request_id"],
            ))
        self.assertEqual(stale["type"], "error")
        self.assertIn("لا تطابق", stale["text"])
        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            final = json.loads(S.respond(
                None, None, "tldm-sham_v2-web", "قم بجولة بحث في الإنترنت عن موقع أكواد ضخم",
                resume_tool_name="web_search", resume_tool_arguments_json='{"query":"موقع أكواد ضخم"}',
                resume_tool_result="مصادر البحث: موقع برمجي وملفات توثيق.",
                resume_tool_request_id=first["tool_request_id"],
            ))
        self.assertEqual(final["type"], "text")
        self.assertIn("نتيجة البحث", final["text"])
        self.assertTrue(any("مصادر البحث" in str(item[1]) for item in seen[-1] if isinstance(item, (list, tuple)) and len(item) > 1))

    def test_sensitive_command_pauses_for_allow_deny_on_model_computer(self):
        class R:
            def __init__(self, needs=False, out="", ok=True, refused=""):
                self.needs_confirmation = needs
                self.out = out
                self.ok = ok
                self.refused = refused

        runs = []

        class Backend:
            def run(self, cmd, confirm=False):
                runs.append((cmd, confirm))
                if cmd == "rm -rf /tmp/x" and not confirm:
                    return R(needs=True, ok=False, refused="policy: destructive command")
                return R(out="ok", ok=True)

        blocks = ["$ ls", "$ rm -rf /tmp/x", "تم"]

        class Chat:
            max_steps = 5
            def backend_factory(self, session):
                return Backend()
            def writer(self, task, hist):
                return blocks[min(len(hist), len(blocks) - 1)]

        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            first = json.loads(S.respond(None, None, "tldm-sham_v2-7", "افعل"))
        self.assertEqual(first["type"], "confirm")
        self.assertEqual(first["command"], "rm -rf /tmp/x")
        self.assertEqual(first["session"], "tldm-sham_v2-7")
        self.assertEqual(first["computer"], "model_computer")
        self.assertNotIn("sandbox", json.dumps(first).lower())
        self.assertEqual(runs, [("ls", False), ("rm -rf /tmp/x", False)])

        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            stale = json.loads(S.respond(None, None, "tldm-sham_v2-7", "افعل", confirm_cmd="wrong", confirm_ok=True))
        self.assertEqual(stale["type"], "error")
        self.assertIn("موافقة", stale["text"])

        runs.clear()
        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            allowed = json.loads(S.respond(None, None, "tldm-sham_v2-7", "افعل", confirm_cmd="rm -rf /tmp/x", confirm_ok=True))
        self.assertEqual(allowed["type"], "text")
        self.assertEqual(allowed["computer"], "model_computer")
        self.assertEqual(runs, [("rm -rf /tmp/x", True)])
        self.assertIn("تم", allowed["text"])
        # the commands that ran on the model's own computer ride in the final reply, so the app can show them as tool steps (they ran inside the Studio)
        self.assertIn("rm -rf /tmp/x", [c["command"] for c in allowed["computer_steps"]])
        self.assertTrue(all(c["ok"] for c in allowed["computer_steps"]) and allowed["computer_steps"][-1]["command"] == "rm -rf /tmp/x")

    def test_deny_does_not_run_the_command_and_continues(self):
        class R:
            def __init__(self, needs=False, out="", ok=True, refused=""):
                self.needs_confirmation = needs
                self.out = out
                self.ok = ok
                self.refused = refused

        runs = []

        class Backend:
            def run(self, cmd, confirm=False):
                runs.append((cmd, confirm))
                if cmd == "dangerous" and not confirm:
                    return R(needs=True, ok=False, refused="policy: sensitive")
                return R(out="ok", ok=True)

        class Chat:
            max_steps = 5
            def backend_factory(self, session):
                return Backend()
            def writer(self, task, hist):
                if not hist:
                    return "$ dangerous"
                return "أُلغي الأمر"

        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            first = json.loads(S.respond(None, None, "s1", "task"))
        self.assertEqual(first["type"], "confirm")
        runs.clear()
        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            denied = json.loads(S.respond(None, None, "s1", "task", confirm_cmd="dangerous", confirm_ok=False))
        self.assertEqual(denied["type"], "text")
        self.assertEqual(runs, [])
        self.assertIn("أُلغي", denied["text"])


# ---- a REAL head file from the trainer (train_sham2.py --cached --tiny --loop --identity), loaded the way the server loads it ----
AI = Path(__file__).resolve().parent.parent
TLDM = AI / "tldm"
TINY_CFG = """latents: 4
think_steps: 2
block: 48
writer_layers: 1
heads: 2
adapter_rank: 4
in_len: 32
steps: 3
batch: 4
lr: 0.001
diffusion_steps: 2
rewordings: false
gate_heldout: 0.6
head_d: 32
confident: 0.9
loop_in_len: 48
loop_block: 64
loop_episodes: 4
loop_steps: 3
loop_batch: 4
loop_eval_episodes: 2
"""


def _tldm_paths():
    for p in (TLDM / "scripts", TLDM, TLDM / "data", TLDM / "memory", AI / "terminal", AI / "colab" / "sham_small"):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))


class Sham2HeadsFromTrainer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import subprocess
        import tempfile
        try:
            import torch  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("torch is not installed")
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        (d / "tiny.yaml").write_text(TINY_CFG, encoding="utf-8")
        cls.path = d / "sham2_heads.pt"
        env = dict(os.environ, PYTHONPATH=str(TLDM) + os.pathsep + os.environ.get("PYTHONPATH", ""))
        r = subprocess.run([sys.executable, str(TLDM / "training" / "train_sham2.py"), "--config", str(d / "tiny.yaml"), "--tiny", "--cached", "--loop",
                            "--identity", "--identity_steps", "2", "--terminal", "sandbox", "--out", str(cls.path), "--json", str(d / "r.json")],
                           cwd=str(TLDM), env=env, capture_output=True, text=True, timeout=900)
        if r.returncode != 0 or not cls.path.is_file():
            raise AssertionError("train_sham2.py --cached --tiny failed:\n" + r.stdout[-2000:] + r.stderr[-3000:])
        _tldm_paths()
        import importlib.util
        spec = importlib.util.spec_from_file_location("train_sham2_for_serve_test", TLDM / "training" / "train_sham2.py")
        cls.TS = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.TS)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        for k in ("SHAM_TLDM", "SHAM_TLDM_REPO", "SHAM_TLDM_CKPT"):
            os.environ.pop(k, None)
        S._LOADED.clear()
        S._PENDING.clear()
        S._IDENTITY.clear()

    def body(self, adapters=False):
        import torch
        torch.manual_seed(1)
        mod = self.TS._sham_small_module("model")
        cfg = mod.ShamSmallConfig(vocab_size=400, d_model=64, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=512)
        b = mod.ShamSmall(cfg).eval()
        if adapters:
            b.enable_adapters(4)
        return b

    def enc(self):
        return self.TS.tiny_body(4)[1]

    def test_trainer_file_is_found_and_read(self):
        os.environ["SHAM_TLDM_CKPT"] = str(self.path)
        self.assertEqual(S._find_local_head(), self.path)
        self.assertEqual(S.download_head(), self.path)
        p = S.read_payload(self.path)
        self.assertEqual(set(p["heads"]), {"writer", "loop_seed0", "identity_lora"})
        self.assertEqual(S.loop_key(p["heads"]), "loop_seed0")
        self.assertIn("proj.weight", p["heads"]["writer"])

    def test_snapshot_dir_with_sham2_heads_is_found(self):
        import shutil
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            sub = Path(d) / "novaai2026" / "sham2-tldm-head"
            sub.mkdir(parents=True)
            shutil.copy2(self.path, sub / "sham2_heads.pt")
            fake = types.SimpleNamespace(snapshot_download=lambda repo, cache_dir=None, token=None: str(sub))
            with mock.patch.dict(sys.modules, {"modelscope_hub": types.SimpleNamespace(compat=fake), "modelscope_hub.compat": fake}), \
                    mock.patch.object(S, "_find_local_head", return_value=None):
                self.assertEqual(S.download_head("t"), sub / "sham2_heads.pt")

    def test_heads_rebuild_at_head_d_on_body_width_and_match_training(self):
        """The server's writer = training's BodyReader + FeatureTLDM on the same body (same ids, same features, same output)."""
        import copy
        import torch
        p = S.read_payload(self.path)
        cfg, heads = p["cfg"], p["heads"]
        body, enc = self.body(adapters=True), self.enc()
        S._on_path()
        loop = S.build_feature_head(heads["loop_seed0"], cfg, 64, int(cfg["loop_block"]))
        self.assertEqual(loop.proj.weight.shape, (int(cfg["head_d"]), 64))
        task = "count the files here and write the number in summary.txt"
        hist = [("ls | wc -l", "7")]
        import augment as AUG
        dt, dh, slots = self.TS.J.delex_view(task, hist, True)
        n = int(cfg["loop_in_len"])
        self.assertEqual(S.loop_ids(enc, dt, dh, n), self.TS.loop_ids(enc, dt, dh, n))
        self.assertEqual(S.text_ids(enc, task, 32), self.TS.text_ids(enc, task, 32))
        reader = self.TS.BodyReader(copy.deepcopy(body))
        h_ref, pad_ref = reader.feats([self.TS.loop_ids(enc, dt, dh, n)], n)
        h, pad = S.BodyFeatures(body).feats(S.loop_ids(enc, dt, dh, n), n)
        self.assertTrue(torch.allclose(h, h_ref, atol=1e-5) and torch.equal(pad, pad_ref))
        out_ref, _ = loop.generate(h_ref, pad_ref, steps=int(cfg["diffusion_steps"]), confident=float(cfg["confident"]))
        from sham_tldm.model import decode_bytes
        ref_text = AUG.relex(decode_bytes(out_ref[0].tolist()), slots)
        w = S.make_feature_writer(body, enc, cfg, heads)
        self.assertEqual(w.mode, "loop")
        self.assertFalse(w.hints)
        self.assertEqual(w(task, [("ls | wc -l", "7", True)]), ref_text)
        self.assertEqual(len(body.final_norm._forward_hooks), 0)            # no hook left on the live body

    def test_writer_only_head_writes_one_command_then_replies(self):
        p = S.read_payload(self.path)
        heads = {"writer": p["heads"]["writer"]}
        S._on_path()
        w = S.make_feature_writer(self.body(adapters=True), self.enc(), p["cfg"], heads)
        self.assertEqual(w.mode, "writer")
        self.assertTrue(w("count the files", []).startswith("$ "))
        self.assertEqual(w("count the files", [("ls | wc -l", "7", True)]), "7")

    def test_identity_lora_goes_into_the_body_for_every_chat(self):
        import torch
        body = self.body()
        self.assertFalse(any(".adapter_" in k for k, _ in body.named_parameters()))
        ids = torch.tensor([[5, 6, 7, 8]])
        with torch.no_grad():
            before = body(ids)[0].clone()
        st = S.apply_identity(body, self.path)
        self.assertTrue(st["identity_lora"], st)
        lora = S.read_payload(self.path)["heads"]["identity_lora"]
        params = dict(body.named_parameters())
        self.assertEqual(set(lora), {k for k in params if ".adapter_" in k})
        for k, v in lora.items():
            self.assertTrue(torch.equal(params[k], v), k)
        with torch.no_grad():
            after = body(ids)[0]
        self.assertFalse(torch.equal(before, after))                          # the plain body forward (every chat path) now runs WITH the LoRA
        self.assertTrue(S.status_fields()["identity_lora"])
        self.assertTrue(S.apply_identity(body, self.path)["identity_lora"])   # idempotent

    def test_merged_identity_is_the_same_function_without_adapters(self):
        import torch
        body = self.body()
        self.assertTrue(S.apply_identity(body, self.path)["identity_lora"])
        ids = torch.tensor([[5, 6, 7, 8, 9]])
        with torch.no_grad():
            unmerged = body(ids)[0].clone()
        n = S.merge_identity(body)
        self.assertGreater(n, 0)
        self.assertFalse(any(".adapter_" in k for k, _ in body.named_parameters()))          # plain Linear projections again
        with torch.no_grad():
            merged = body(ids)[0]
        self.assertTrue(torch.allclose(unmerged, merged, atol=1e-4), float((unmerged - merged).abs().max()))
        self.assertEqual(S.merge_identity(body), 0)                                          # idempotent
        self.assertTrue(S.apply_identity(body, self.path)["identity_lora"])                  # the same head: the cached status
        other = S.apply_identity(body, None, S.read_payload(self.path))                                # another head after a merge is refused, never double-applied
        self.assertFalse(other["identity_lora"])
        self.assertIn("merged", other["identity_lora_why"])

    def test_identity_that_does_not_fit_is_refused_and_body_unchanged(self):
        import torch
        p = S.read_payload(self.path)
        bad = {k: torch.zeros(v.shape[0] + 1, *v.shape[1:]) for k, v in p["heads"]["identity_lora"].items()}
        body = self.body()
        ids = torch.tensor([[5, 6, 7, 8]])
        with torch.no_grad():
            before = body(ids)[0].clone()
        st = S.apply_identity(body, self.path, {"cfg": p["cfg"], "heads": {"writer": p["heads"]["writer"], "identity_lora": bad}})
        self.assertFalse(st["identity_lora"])
        with torch.no_grad():
            self.assertTrue(torch.equal(before, body(ids)[0]))

    def test_server_starts_without_a_head(self):
        body = self.body()
        with mock.patch.object(S, "download_head", return_value=None):
            st = S.startup_identity(body, None)
        self.assertFalse(st["identity_lora"])
        self.assertFalse(any(".adapter_" in k for k, _ in body.named_parameters()))
        f = S.status_fields()
        self.assertFalse(f["tldm"])
        self.assertFalse(f["tldm_head"])
        self.assertFalse(f["identity_lora"])
        with mock.patch.object(S, "download_head", side_effect=OSError("no network")):
            self.assertFalse(S.startup_identity(body, None)["identity_lora"])

    def test_build_chat_and_respond_on_the_real_file(self):
        body, enc = self.body(), self.enc()
        chat = S.build_chat(body, enc, self.path)
        self.assertEqual(chat.writer.mode, "loop")
        self.assertTrue(S._IDENTITY.get("identity_lora"))                    # the head reads the body WITH its identity LoRA, as trained
        runs = []

        class R:
            ok, out, refused, needs_confirmation, code = True, "3", "", False, 0

        class Backend:
            def run(self, cmd, confirm=False):
                runs.append(cmd)
                return R()

        chat.backend_factory = lambda session: Backend()
        with mock.patch.object(S, "load_chat", return_value=(chat, "")):
            out = json.loads(S.respond(body, enc, "s-real", "count the files here and write the number in out.txt"))
        self.assertIn(out["type"], ("text", "confirm"))
        self.assertTrue(out["tldm"])


class IdentityGate(unittest.TestCase):
    """2026-11-24: the identity LoRA is attached only on a turn that asks who / what the model is."""

    def test_identity_questions(self):
        for q in ("من أنت؟", "مين انت", "ما اسمك؟", "شو اسمك", "اسمك ايه", "عرّف بنفسك", "من صنعك؟", "مين طورك", "هل أنت Qwen؟", "أي نموذج أنت؟",
                  "Who are you?", "What is your name?", "who made you", "Are you ChatGPT?", "Introduce yourself.", "What model am I chatting with?",
                  "Were you developed by Alibaba?", "Tell me your name.", "من الشركة التي طورتك؟", "ما هو اسمك الحقيقي؟", "هل أنت تونغيي أو Qwen؟", "Who built you?"):
            self.assertTrue(S.asks_identity(q), q)
        for q in ("مرحبا", "ما عاصمة سوريا؟", "اكتب دالة بايثون تعيد مضروب عدد.", "كم يساوي 17 ضرب 23؟", "اشرح باختصار ما هو التعلم الآلي.",
                  "What is the capital of Japan?", "اعرض الملفات في المجلد الحالي على حاسوبك.", "هل أنت متأكد؟", "how are you?", "من أنتج فيلم التيتانيك؟",
                  "write a story about a robot who names itself", ""):
            self.assertFalse(S.asks_identity(q), q)

    def _body(self):
        import torch
        from torch import nn

        class Ad(nn.Module):
            def __init__(self, base):
                super().__init__()
                self.base = base
                self.adapter_down = nn.Parameter(torch.ones(1, base.in_features))
                self.adapter_up = nn.Parameter(torch.ones(base.out_features, 1))
                self.scale = 1.0

            def forward(self, x):
                return self.base(x) + (x @ self.adapter_down.t()) @ self.adapter_up.t() * self.scale

        class Body(nn.Module):
            def __init__(self):
                super().__init__()
                torch.manual_seed(0)
                self.q = Ad(nn.Linear(4, 4))
                self.k = Ad(nn.Linear(4, 4))

            def forward(self, x):
                return self.k(self.q(x))

        return Body()

    def test_export_view_keeps_plain_projections_while_identity_turns_run(self):
        # deploy smoke 45491658168: the body was frozen for the whole llama.cpp export, so «من أنت؟» meanwhile got the donor's answer. The export now reads a view.
        import torch
        from sham_gguf import plain_view
        body = self._body()
        S.gate_identity(body)
        x = torch.ones(1, 4)
        plain = body(x).detach().clone()
        view = plain_view(body)
        self.assertEqual(view.q.weight.data_ptr(), body.q.weight.data_ptr())       # no weight copied
        with S.identity_for(body, "من أنت؟") as on:
            self.assertTrue(on)
            self.assertFalse(torch.allclose(body(x), plain))                     # the live turn has its adapter
            self.assertTrue(torch.allclose(view(x), plain))                      # the export still reads the donor
        self.assertTrue(torch.allclose(body(x), plain))
        self.assertFalse(hasattr(view, "_identity_gate"))

    def test_gate_attaches_only_inside_the_block(self):
        try:
            import torch
        except ImportError:
            self.skipTest("torch not installed")
        body = self._body()
        x = torch.ones(1, 4)
        with torch.no_grad():
            with_lora = body(x).clone()
            plain = body.k.base(body.q.base(x)).clone()
        self.assertEqual(S.gate_identity(body), 2)
        self.assertEqual(S.gate_identity(body), 2)                        # idempotent
        with torch.no_grad():
            self.assertTrue(torch.allclose(body(x), plain))              # ordinary turn: plain donor projections
            with S.identity_for(body, "من أنت؟") as on:
                self.assertTrue(on)
                self.assertTrue(torch.allclose(body(x), with_lora))      # identity turn: the trained adapter
            self.assertTrue(torch.allclose(body(x), plain))              # restored
            with S.identity_for(body, "ما عاصمة سوريا؟") as on:
                self.assertFalse(on)
                self.assertTrue(torch.allclose(body(x), plain))
            with S.identity_for(body, True):
                self.assertTrue(torch.allclose(body(x), with_lora))      # the T-LDM head reads the body WITH the adapter
            body._identity_frozen = True                                  # llama.cpp export in progress
            with S.identity_for(body, "Who are you?") as on:
                self.assertFalse(on)
            body._identity_frozen = False
        self.assertNotIn("q.adapter_down", dict(body.named_parameters()))

    def test_body_without_adapters_is_untouched(self):
        try:
            from torch import nn
        except ImportError:
            self.skipTest("torch not installed")
        body = nn.Sequential(nn.Linear(2, 2))
        self.assertEqual(S.gate_identity(body), 0)
        with S.identity_for(body, "من أنت؟") as on:
            self.assertFalse(on)



class UnfilledSlots(unittest.TestCase):
    def test_slot_pattern(self):
        for bad in ("$ echo @T1", "الخرج: @T1", "python3 -c 'for i in range(@N1,@N2+1)'", "cat @F1"):
            self.assertTrue(S.UNFILLED_SLOT.search(bad), bad)
        for ok in ("$ echo SHAM_OK", "user@host", "a@b.com", "$ ls -la", "الخرج: 391"):
            self.assertFalse(S.UNFILLED_SLOT.search(ok), ok)


if __name__ == "__main__":
    unittest.main()
