"""Sham's live CPU/GPU trainer as a free ModelScope Studio (a Gradio app whose background thread trains, publishes, and starts again).

Same job as the GitHub CPU trainer and the Oracle one: sham_live.run(...) starts from the newest published head, trains for SHAM_TRAINER_HOURS, publishes ITS OWN lineage
(sham-crawl-<SHAM_TRAINER_NAME> + its corpus) to Kaggle; the merge job finds every sham-crawl-* dataset by itself and judges it through the same gate, so nothing else changes.
Device: sham_live picks CUDA when the Studio has a GPU and CPU otherwise (the free tier is CPU), so the same file serves both.

Settings come from the Studio's secrets (set by deploy-sham-trainer-studio.yml): KAGGLE_USERNAME, KAGGLE_API_TOKEN, SHAM_TRAINER_NAME, SHAM_TRAINER_HOURS, SHAM_TRAINER_JOB (live|images|audio|chat|tools|text|codec|motion|tldm), HF_ENDPOINT (hf-mirror: huggingface.co is
blocked from China). Nothing here prints a secret. Offline self-test: python app.py --selftest
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import traceback
from pathlib import Path

# The Studio's container has 8 GB of memory and the root file system counts against it (2026-11-13 memory watch: process 4.0 GB, container 7.1 GB, then killed with -9 right after the chat data
# loaded). The persistent disk /mnt/workspace does not: downloads (the 850 MB head), the Hugging Face dataset cache and temp files go there when it exists. Inherited by the cycle process.
_DISK = Path("/mnt/workspace")
if _DISK.is_dir() and os.access(_DISK, os.W_OK):
    for _k, _sub in (("SHAM_LIVE_WORK", "live_work"), ("SHAM_FETCH_ROOT", "inputs"), ("HF_HOME", "hf"), ("HF_DATASETS_CACHE", "hf/datasets"), ("TMPDIR", "tmp")):
        _p = _DISK / "sham_trainer" / _sub
        try:
            _p.mkdir(parents=True, exist_ok=True)
            os.environ.setdefault(_k, str(_p))
        except OSError:
            pass
    _tldm = _DISK / "tldm"
    try:
        _tldm.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("TLDM_WORK", str(_tldm))
    except OSError:
        pass

HERE = Path(__file__).resolve().parent
SHAM = HERE / "sham_small"                      # the sham_small code the deploy workflow copies next to this file
WORK = Path(os.environ.get("SHAM_LIVE_WORK") or (Path.home() / "sham_live_work"))
STATE: dict = {"phase": "starting", "cycle": 0, "device": "?", "started": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "last": {}, "error": ""}
_LOCK = threading.Lock()


# What each Studio is FOR (SHAM_TRAINER_JOB). Chosen from the 2026-11-11 structure review of Sham v1: the picture generator writes only ~28 distinct codes of 256 (loss 7.70, the codec itself is fine at 20 dB),
# chat/tool skills sit at a plateau behind the merge gate (text 4.62 / chat 2.01 / media 7.25), audio has little training share. Each profile is only a set of environment shares for sham_live:
# nothing but WHAT is collected and mixed changes; the guard, the held-out measures and the merge gate stay the same.
PROFILES = {
    "live":   {},                                                                                                                # the general mix (same as the GitHub / Oracle trainers)
    "images": {"SHAM_LIVE_KINDS": "image", "SHAM_REHEARSAL_SHARE": "0.25", "SHAM_GENERAL_SHARE": "0.30", "SHAM_TOOLS_MIX": "0.02"},   # caption -> picture codes, text kept alive by rehearsal + general windows
    "audio":  {"SHAM_LIVE_KINDS": "audio", "SHAM_REHEARSAL_SHARE": "0.25", "SHAM_GENERAL_SHARE": "0.30", "SHAM_TOOLS_MIX": "0.02"},
    "chat":   {"SHAM_LIVE_KINDS": "text", "SHAM_REHEARSAL_SHARE": "0.45", "SHAM_GENERAL_SHARE": "0.25", "SHAM_TOOLS_MIX": "0.08", "SHAM_CHAT_MULTITURN": "1"},     # dialogue + memory
    "tools":  {"SHAM_LIVE_KINDS": "text", "SHAM_REHEARSAL_SHARE": "0.30", "SHAM_GENERAL_SHARE": "0.25", "SHAM_TOOLS_MIX": "0.40"},                                # the 44 tools and their paths
    "text":   {"SHAM_LIVE_KINDS": "text", "SHAM_REHEARSAL_SHARE": "0.20", "SHAM_GENERAL_SHARE": "0.55", "SHAM_TOOLS_MIX": "0.03"},                                # general text and code (the plateau)
    # the picture codec itself (not the language model): a NEW high-resolution lineage, 384 px = 24x24 = 576 tokens, published as sham-image-tokenizer-hd-checkpoint. The serving tokenizer is never touched.
    # Measured (sham_vq_bench): a 2-thread CPU trains ~1,150 pictures/hour at 256 px, so this is a slow trickle here; the bulk of an HD codec needs a GPU (Kaggle's weekly quota).
    "codec":  {"SHAM_IMG_SIZE": "384", "SHAM_TOK_AUDIO": "0", "SHAM_TOK_THREADS": "2"},
    # the motion codec: real clips -> consecutive frame pairs -> a motion tokenizer that beats "copy the previous frame"; published as sham-motion-tokenizer-checkpoint (resumes the newest one)
    "motion": {"SHAM_TOK_THREADS": "2"},
    # T-LDM on the Studio (CPU): the kept pretrained-reader head (DonorTLDM, writer_donor.yaml) — train + held-out benchmark each cycle.
    # evolve / LoRA-on-failures is optional (SHAM_TLDM_EVOLVE=1): always mixed with replay, and an adapter is kept only if held-out and previously-correct scores do not regress.
    # The same gate is the commercial self-evolution path for Sham 2: later it will ingest anonymized, verified execution results from all users' sessions (no personal data, not wired yet).
    "tldm":   {},
}


def run_codec(hours: float = 5.0, **_ignored) -> dict:
    """The "codec" job: ai-system/lightning/tokenizer_job.py (collect pictures, train the image tokenizer in chunks, publish) for `hours`. Returns whitelisted numbers."""
    for sub in ("lightning", "sham_small"):
        sys.path.insert(0, str(HERE / sub))
    os.environ.setdefault("SHAM_FACTORY_DIR", str(WORK / "factory"))
    import tokenizer_job
    tokenizer_job.HOURS = float(hours)
    code = tokenizer_job.main()
    prog = tokenizer_job._progress("image")
    return {"steps": int(prog.get("steps", 0)), "published": code == 0, "corpus": int(prog.get("samples", 0)), "hours": float(hours)}


def run_motion(hours: float = 3.0, **_ignored) -> dict:
    """The "motion" job: ai-system/lightning/motion_job.py for `hours`."""
    for sub in ("lightning", "sham_small"):
        sys.path.insert(0, str(HERE / sub))
    os.environ.setdefault("SHAM_FACTORY_DIR", str(WORK / "factory"))
    import motion_job
    motion_job.HOURS = float(hours)
    code = motion_job.main()
    return {"published": code == 0, "hours": float(hours)}


TLDM_REPO = "tldm-writer-runs"
TLDM_CONFIG_DEFAULT = "writer_donor.yaml"
TLDM_LOOP_CONFIG_DEFAULT = "loop.yaml"
TLDM_DONOR_ID = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def tldm_root() -> Path:
    """The tldm tree the deploy workflow copies next to this file; the repo layout is the fallback (self-test / checkout)."""
    here = HERE / "tldm"
    if (here / "training" / "train_0.3b.py").is_file():
        return here
    repo = HERE.parent / "tldm"
    if (repo / "training" / "train_0.3b.py").is_file():
        return repo
    raise FileNotFoundError("tldm tree is missing (training/train_0.3b.py); deploy-sham-trainer-studio.yml must copy ai-system/tldm next to app.py when job=tldm")


def tldm_work() -> Path:
    return Path(os.environ.get("TLDM_WORK") or (Path("/mnt/workspace/tldm") if Path("/mnt/workspace").is_dir() else (HERE / "tldm_work")))


def tldm_sidecars(root: Path | None = None) -> tuple[Path, Path]:
    """sandbox_terminal and exec_verify sit next to the tldm tree (ai-system/ in the repo, copied next to app.py in the Studio)."""
    parent = (root or tldm_root()).parent
    return parent / "terminal" / "sandbox_terminal.py", parent / "distill" / "exec_verify.py"


def tldm_sidecars_ok(root: Path | None = None) -> bool:
    a, b = tldm_sidecars(root)
    return a.is_file() and b.is_file()


def tldm_next_seed(work: Path) -> int:
    path = work / "seed.txt"
    try:
        return int(path.read_text(encoding="utf-8").strip() or "0")
    except (FileNotFoundError, ValueError):
        try:
            return int(os.environ.get("SHAM_TLDM_SEED") or 0)
        except ValueError:
            return 0


def tldm_store_seed(work: Path, seed: int) -> None:
    work.mkdir(parents=True, exist_ok=True)
    (work / "seed.txt").write_text(str(int(seed)), encoding="utf-8")


def tldm_cmd_opt(cmd: list, flag: str) -> str | None:
    if flag in cmd:
        i = cmd.index(flag)
        if i + 1 < len(cmd):
            return cmd[i + 1]
    return None


def tldm_script(cmd: list) -> str:
    for part in cmd:
        if str(part).endswith(".py"):
            return Path(part).name
    return ""


# MiniLM L12-v2 model.safetensors is 470,641,600 bytes. A mid-download kill can leave config.json plus a truncated weight; that must not count as ready.
DONOR_WEIGHT_MIN = 400 * 1024 * 1024


def donor_weight_size(dest: Path) -> int:
    """Total bytes of the reader weight files (single file or shards). 0 if none."""
    dest = Path(dest)
    files = [dest / n for n in ("model.safetensors", "pytorch_model.bin", "model.bin") if (dest / n).is_file()]
    if not files:
        files = sorted(dest.glob("model*.safetensors")) + sorted(dest.glob("pytorch_model*.bin"))
    return int(sum(p.stat().st_size for p in files))


def donor_ready(dest: Path) -> bool:
    """True only when config.json and a weight file larger than 400 MB are both present."""
    dest = Path(dest)
    return (dest / "config.json").is_file() and donor_weight_size(dest) > DONOR_WEIGHT_MIN


def _copy_donor_tree(src: Path, dest: Path) -> None:
    """Copy a downloaded snapshot into dest, replacing missing or smaller (truncated) files."""
    import shutil
    src, dest = Path(src), Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    for f in src.rglob("*"):
        if not f.is_file() or ".git" in f.parts:
            continue
        target = dest / f.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        if (not target.exists()) or target.stat().st_size < f.stat().st_size:
            shutil.copy2(f, target)


def ensure_donor(work: Path, download: bool = True) -> Path:
    """Local copy of paraphrase-multilingual-MiniLM-L12-v2 (frozen reader). Kept on /mnt/workspace/tldm/donor so later cycles do not download again.
    Ready only if config.json and a weight file >400 MB exist; a truncated leftover is wiped and replaced."""
    import shutil
    dest = Path(os.environ.get("TLDM_DONOR") or (work / "donor" / "minilm"))
    if donor_ready(dest):
        os.environ["TLDM_DONOR"] = str(dest)
        print(f"tldm donor ready: {dest} size={donor_weight_size(dest)}", flush=True)
        return dest
    if not download:
        dest.mkdir(parents=True, exist_ok=True)
        os.environ["TLDM_DONOR"] = str(dest)
        return dest
    print(f"tldm donor incomplete ({dest}, size={donor_weight_size(dest)}); wiping and redownloading", flush=True)
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True, exist_ok=True)
    os.environ["TLDM_DONOR"] = str(dest)
    repo = (os.environ.get("TLDM_DONOR_ID") or TLDM_DONOR_ID).strip() or TLDM_DONOR_ID
    errors: list[str] = []
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(repo_id=repo, local_dir=str(dest))
    except Exception as exc:  # noqa: BLE001
        errors.append(f"hf:{type(exc).__name__}:{str(exc)[:160]}")
        try:
            from modelscope import snapshot_download as ms_dl
            src = Path(ms_dl(repo, cache_dir=str(work / "donor" / "ms_cache")))
            _copy_donor_tree(src, dest)
        except Exception as exc2:  # noqa: BLE001
            errors.append(f"ms:{type(exc2).__name__}:{str(exc2)[:160]}")
    if not donor_ready(dest):
        raise FileNotFoundError("could not download the frozen reader " + repo + " (" + " | ".join(errors) + f"; size={donor_weight_size(dest)})")
    print(f"tldm donor ready: {dest} size={donor_weight_size(dest)}", flush=True)
    return dest


def tldm_run(cmd: list, cwd: str, env: dict | None, runner, **extra) -> int:
    if runner is not None:
        return int(runner(cmd=cmd, cwd=cwd, **extra))
    import subprocess
    print("tldm run:", " ".join(str(c) for c in cmd), flush=True)
    return int(subprocess.run(cmd, cwd=cwd, env=env, check=False).returncode)


def _num(block, *keys):
    if isinstance(block, (int, float)):
        return block
    if not isinstance(block, dict):
        return None
    for k in keys:
        if isinstance(block.get(k), (int, float)):
            return block[k]
    return None


def tldm_flatten(res: dict, seed: int, published) -> dict:
    """Whitelisted cycle numbers for the status page."""
    out = {"seed": int(seed), "published": bool(published), "config": (res or {}).get("config") or TLDM_CONFIG_DEFAULT}
    if not isinstance(res, dict):
        return out
    for k in ("train_secs", "params_M", "loop_trained"):
        if k in res and isinstance(res[k], (int, float, bool, str)) and len(str(res[k])) <= 80:
            out[k] = res[k]
    for k in ("train", "heldout", "heldout2"):
        v = _num(res.get(k), "same_effect")
        if v is not None:
            out[k] = v
    evo = res.get("evolve") or {}
    after = evo.get("after") if isinstance(evo, dict) else None
    v = _num(after, "episode_success")
    if v is not None:
        out["evo_after"] = v
    if "evolve_kept" in res:
        out["evolve_kept"] = bool(res["evolve_kept"])
    se = (res.get("safe_evolve") or {}).get("after") if isinstance(res.get("safe_evolve"), dict) else None
    v = _num((se or {}).get("eval60_778") if isinstance(se, dict) else None, "episode_success")
    if v is not None:
        out["evo_after"] = v
    return out


def publish_tldm(work: Path, seed: int, artifacts: list) -> str | None:
    """Publish this cycle's checkpoints and JSON to the private ModelScope repo tldm-writer-runs (owner from SHAM_MS_OWNER, hub from MODELSCOPE_DOMAIN)."""
    sys.path.insert(0, str(SHAM))
    import shutil

    import sham_inputs
    apply = getattr(sham_inputs, "_apply_ms_hub_endpoint", None)
    if callable(apply):
        apply()
    snap = work / "publish_snap"
    shutil.rmtree(snap, ignore_errors=True)
    snap.mkdir(parents=True)
    seen: set[str] = set()
    for src in artifacts:
        src = Path(src)
        if not src.is_file():
            continue
        dest = snap / src.name
        if dest.name in seen:
            dest = snap / f"{src.parent.name}_{src.name}"
        seen.add(dest.name)
        try:
            os.link(src, dest)
        except OSError:
            shutil.copy2(src, dest)
    jsonl = work / "logs" / "results.jsonl"
    if jsonl.exists():
        try:
            os.link(jsonl, snap / "results.jsonl")
        except OSError:
            shutil.copy2(jsonl, snap / "results.jsonl")
    name = (os.environ.get("SHAM_TLDM_REPO") or TLDM_REPO).strip() or TLDM_REPO
    got = sham_inputs.publish_modelscope(snap, name, f"tldm cycle seed={seed}")
    shutil.rmtree(snap, ignore_errors=True)
    return got


def _json_ok(path: Path) -> bool:
    try:
        return isinstance(json.loads(path.read_text(encoding="utf-8")), dict)
    except (OSError, ValueError):
        return False


def run_tldm(hours: float = 10.0, name: str = "ms1", runner=None, **_ignored) -> dict:
    """Main cycle: train the frozen-reader head (writer_donor.yaml) and evaluate both held-out sets, then publish.
    Optional (SHAM_TLDM_EVOLVE=1): replay-mixed LoRA on verified failures (and, later, anonymized verified session results), kept only if held-out and previously-correct do not regress."""
    work = tldm_work()
    (work / "checkpoints" / "loop").mkdir(parents=True, exist_ok=True)
    (work / "logs").mkdir(parents=True, exist_ok=True)
    seed = tldm_next_seed(work)
    root = tldm_root()
    if not tldm_sidecars_ok(root):
        missing = [str(p) for p in tldm_sidecars(root) if not p.is_file()]
        raise FileNotFoundError("tldm sidecars missing (deploy must also copy ai-system/terminal and ai-system/distill): " + ", ".join(missing))
    ensure_donor(work, download=runner is None)
    cfg_name = (os.environ.get("SHAM_TLDM_CONFIG") or TLDM_CONFIG_DEFAULT).strip() or TLDM_CONFIG_DEFAULT
    config = Path(cfg_name) if Path(cfg_name).is_file() else (root / "configs" / cfg_name)
    donor_ckpt = work / "checkpoints" / f"donor_seed{seed}.pt"
    donor_json = work / "logs" / f"donor_seed{seed}.json"
    report = work / "logs" / f"cycle_seed{seed}.json"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(root) + os.pathsep + str(HERE) + os.pathsep + env.get("PYTHONPATH", "")
    env["TLDM_DONOR"] = os.environ.get("TLDM_DONOR") or str(work / "donor" / "minilm")
    extra = (os.environ.get("SHAM_TLDM_STEPS") or "").strip()
    artifacts: list = []
    res: dict = {"seed": seed, "config": config.name}

    donor_cmd = [sys.executable, "-u", str(root / "training" / "train_0.3b.py"),
                 "--config", str(config), "--out", str(donor_ckpt), "--seed", str(seed), "--json", str(donor_json)]
    if extra:
        donor_cmd.extend(["--steps", extra])
    print(f"tldm cycle seed={seed} donor config={config.name} out={donor_ckpt}", flush=True)
    if _json_ok(donor_json) and donor_ckpt.is_file() and donor_ckpt.stat().st_size > 0:
        # 2026-11-18: this seed's head was already trained when the cycle was interrupted (crash, stuck kill, Studio restart): resume after it instead of training it again
        print(f"tldm resume: seed {seed} head already trained ({donor_ckpt.name}); continuing from it", flush=True)
        code = 0
    else:
        code = tldm_run(donor_cmd, str(root), env, runner, ckpt=donor_ckpt, report=donor_json, seed=seed, work=work, arm="donor")
    if code != 0:
        raise RuntimeError(f"tldm donor train exited with code {code} (seed {seed})")
    if donor_json.exists():
        try:
            res.update(json.loads(donor_json.read_text(encoding="utf-8")))
        except ValueError:
            pass
        artifacts.append(donor_json)
    if donor_ckpt.exists():
        artifacts.append(donor_ckpt)

    evolve_on = (os.environ.get("SHAM_TLDM_EVOLVE") or "").strip().lower() in ("1", "true", "yes")
    if evolve_on:
        sys.path.insert(0, str(HERE))
        from safe_evolve import run_safe_evolve
        loop_cfg_name = (os.environ.get("SHAM_TLDM_LOOP_CONFIG") or TLDM_LOOP_CONFIG_DEFAULT).strip() or TLDM_LOOP_CONFIG_DEFAULT
        loop_config = Path(loop_cfg_name) if Path(loop_cfg_name).is_file() else (root / "configs" / loop_cfg_name)
        loop_ckpt = work / "checkpoints" / "loop" / "final.pt"
        loop_steps = (os.environ.get("SHAM_TLDM_LOOP_STEPS") or "").strip()
        retrained = False
        if (os.environ.get("SHAM_TLDM_RETRAIN_LOOP") or "").strip() == "1" or not loop_ckpt.exists():
            loop_cmd = [sys.executable, "-u", str(root / "training" / "train_loop.py"),
                        "--config", str(loop_config), "--out", str(loop_ckpt), "--seed", str(seed)]
            if loop_steps:
                loop_cmd.extend(["--steps", loop_steps])
            print(f"tldm loop train (optional evolve) config={loop_config.name} out={loop_ckpt}", flush=True)
            code = tldm_run(loop_cmd, str(root), env, runner, ckpt=loop_ckpt, seed=seed, work=work, arm="loop")
            if code != 0:
                print(f"tldm loop train exited {code}; skipping optional evolve", flush=True)
                loop_ckpt = Path()
            else:
                retrained = True
        res["loop_trained"] = retrained
        if loop_ckpt and loop_ckpt.exists():
            artifacts.append(loop_ckpt)
            ev = run_safe_evolve(root, work, loop_ckpt, seed, runner=runner)
            res["safe_evolve"] = ev
            ev_json = work / "logs" / f"safe_evolve_seed{seed}.json"
            if ev_json.exists():
                artifacts.append(ev_json)
            if ev.get("kept") and ev.get("adapter"):
                artifacts.append(Path(ev["adapter"]))
            res["evolve_kept"] = bool(ev.get("kept"))

    tldm_store_seed(work, seed + 1)
    report.write_text(json.dumps({k: v for k, v in res.items() if k != "secret"}, ensure_ascii=False, indent=1), encoding="utf-8")
    artifacts.append(report)
    try:
        latest = work / "logs" / "latest.json"
        latest.write_text(report.read_text(encoding="utf-8"), encoding="utf-8")
        artifacts.append(latest)
    except OSError:
        pass
    with (work / "logs" / "results.jsonl").open("a", encoding="utf-8") as f:
        slim = {k: res[k] for k in res if k not in ("safe_evolve", "lora_failed", "evolve", "secret")}
        if isinstance(res.get("safe_evolve"), dict):
            slim["evolve_kept"] = res["safe_evolve"].get("kept")
        f.write(json.dumps({"seed": seed, **slim}, ensure_ascii=False) + "\n")
    published = None
    try:
        published = publish_tldm(work, seed, artifacts)
    except Exception as exc:  # noqa: BLE001 - the files stay on disk; the next cycle still runs
        print(f"tldm publish failed: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
    out = tldm_flatten(res, seed, bool(published))
    out["hours"] = float(hours)
    print(f"tldm cycle done seed={seed} heldout={out.get('heldout')} heldout2={out.get('heldout2')} published={out['published']}", flush=True)
    return out


SHAM2_DONOR_REPO = "novaai2026/sham-v2"          # Sham 2's donor weights: READ only (downloaded copy); the repo, Sham 1 and every live Studio stay untouched
SHAM2_HEAD_REPO = "sham2-tldm-head"               # where the trained T-LDM heads + results go (private, its own repo; never sham-v2)


def sham2_mode(name: str) -> bool:
    """job=tldm with name sham2* runs the Sham 2 T-LDM job instead of the writer cycles (same deploy path: the tldm tree is copied for job=tldm)."""
    return str(name or "").startswith("sham2")


def sham2_flatten(res: dict) -> dict:
    out = {}
    for k in ("train", "heldout", "heldout2"):
        v = (res.get(k) or {}).get("same_effect")
        if isinstance(v, (int, float)):
            out[k] = v
    w = res.get("writer") or []
    if w:
        out["heldout_seeds"] = "/".join(str(r["heldout"]["same_effect"]) for r in w)
        out["heldout2_seeds"] = "/".join(str(r["heldout2"]["same_effect"]) for r in w)
    lp = res.get("loop") or []
    if lp:
        out["loop_all"] = lp[0]["all"]["success"]
        out["loop_simple"] = lp[0]["simple"]["success"]
        out["loop_multi"] = lp[0]["multi_step"]["success"]
        out["loop_s_per_task"] = lp[0]["all"]["median_s_per_task"]
    idn = res.get("identity") or {}
    if idn:
        out["identity_before"] = idn["before"]["identity"]["ok"]
        out["identity_after"] = idn["after"]["identity"]["ok"]
        out["nll_before"] = idn["before"]["general_nll"]
        out["nll_after"] = idn["after"]["general_nll"]
    for k in ("body_read_secs", "body_params_M", "dtype", "donor_weights_unchanged"):
        if k in res:
            out[k] = res[k]
    return out


SHAM2_DONOR_HOST = "www.modelscope.cn"           # novaai2026/sham-v2 lives on the cn hub (account novaai2026, token MODELSCOPE_TOKEN)


def sham2_hub_check(env=None) -> str:
    """'' when this Studio can read the donor; else why not. No silent fallback: the donor is on modelscope.cn, so the job must run on a cn Studio with the cn token
    (an .ai Studio, MODELSCOPE_DOMAIN=www.modelscope.ai or owner Jonjithup, cannot read it)."""
    env = os.environ if env is None else env
    dom = (env.get("MODELSCOPE_DOMAIN") or env.get("MODELSCOPE_HUB_ENDPOINT") or "").replace("https://", "").replace("http://", "").strip("/")
    if dom and dom != SHAM2_DONOR_HOST:
        return f"sham2 needs {SHAM2_DONOR_HOST} (donor {SHAM2_DONOR_REPO}); this Studio talks to {dom}: deploy with site=cn"
    if (env.get("SITE") or "").strip().lower() == "ai" or (env.get("SHAM_MS_OWNER") or "").strip().lower() == "jonjithup":
        return f"sham2 needs a cn Studio (account novaai2026): this one is on the international site"
    if not (env.get("MODELSCOPE_API_TOKEN") or env.get("MODELSCOPE_TOKEN")):
        return "sham2 needs the cn ModelScope token in the Studio secrets (MODELSCOPE_API_TOKEN)"
    return ""


def sham2_donor(work: Path, fetch=None) -> tuple[Path, Path]:
    """Download (once) a COPY of the Sham 2 donor weights to this Studio's disk; -> (checkpoint, tokenizer). Read only: nothing is ever written to the model repo."""
    dest = work / "donor"

    def find():
        ck = next(iter(sorted(dest.rglob("final_merged.pt"))), None) or next(iter(sorted(dest.rglob("*.pt"))), None)
        tk = next(iter(sorted(dest.rglob("sham_small_tokenizer.json"))), None)
        return ck, tk
    ck, tk = find() if dest.exists() else (None, None)
    if ck is None or tk is None:
        dest.mkdir(parents=True, exist_ok=True)
        repo = os.environ.get("SHAM2_DONOR_REPO") or SHAM2_DONOR_REPO
        if fetch is not None:
            fetch(repo, dest)
        else:
            why = sham2_hub_check()
            if why:
                raise RuntimeError(why)
            sys.path.insert(0, str(SHAM))
            from ms_hub import apply_ms_hub_endpoint
            # Donor lives on modelscope.cn. The shared helper honors an explicit MODELSCOPE_DOMAIN, so this
            # still talks to cn even if SITE=ai leaked into the environment.
            os.environ["MODELSCOPE_DOMAIN"] = SHAM2_DONOR_HOST
            apply_ms_hub_endpoint()
            import sham_inputs
            sham_inputs._ms_api()                                     # login with the cn token on the cn host (raises on a rejected token)
            from modelscope import snapshot_download
            print(f"sham2: downloading a copy of {repo} from {SHAM2_DONOR_HOST}", flush=True)
            snapshot_download(repo, cache_dir=str(dest))
        ck, tk = find()
        if fetch is None and ck is not None:
            sham2_check_sizes(repo, dest)
    if ck is None or tk is None:
        raise FileNotFoundError("sham2: the donor copy has no checkpoint (*.pt) or sham_small_tokenizer.json")
    return ck, tk


def sham2_check_sizes(repo: str, dest: Path, files=None) -> None:
    """A killed download must not pass as the donor (auditor, 2026-11-18): every repo file's local size must equal the hub's. Raises on a mismatch or a missing file."""
    if files is None:
        try:
            from modelscope.hub.api import HubApi
            files = [(f.get("Path"), f.get("Size")) for f in HubApi().get_model_files(repo, recursive=True) if f.get("Type") != "tree"]
        except Exception as exc:                                      # listing unavailable: say so; train_sham2's NLL guard still stops a random body
            print(f"sham2: hub size check unavailable ({type(exc).__name__}: {str(exc)[:120]})", flush=True)
            return
    bad = []
    for path, size in files:
        if not path or size is None:
            continue
        hit = next(iter(sorted(dest.rglob(Path(path).name))), None)
        if hit is None or hit.stat().st_size != int(size):
            bad.append(f"{path}: hub {size} local {hit.stat().st_size if hit else 'missing'}")
    if bad:
        raise RuntimeError("sham2: donor copy incomplete: " + "; ".join(bad[:5]))
    print(f"sham2: donor copy complete ({len(files)} files match the hub sizes)", flush=True)


def sham2_run_key() -> str:
    """Hash of what decides a Sham 2 run's result: a finished run is redone only when one of these files changes."""
    import hashlib
    root, h = tldm_root(), hashlib.sha256()
    for rel in ("data/identity.py", "data/trajectories.py", "configs/sham2.yaml", "training/train_sham2.py"):
        p = root / rel
        h.update(rel.encode() + (p.read_bytes() if p.exists() else b"-"))
    return h.hexdigest()[:16]


def sham2_gate(root: Path) -> Path:
    """The merged gate results: docs/experiments/tldm_heldout_gate_2026-11-18.json (repo layout), or the copy the Studio deploy keeps next to the tldm tree."""
    for p in (root.parent.parent / "docs" / "experiments" / "tldm_heldout_gate_2026-11-18.json", root / "gate" / "tldm_heldout_gate_2026-11-18.json"):
        if p.is_file():
            return p
    return root / "gate" / "tldm_heldout_gate_2026-11-18.json"


def run_sham2(hours: float = 10.0, name: str = "sham2", runner=None, fetch=None, publish=None, **_ignored) -> dict:
    """Sham 2 = a copy of Sham 1's structure with the donor weights + the T-LDM head. Once: read the donor copy (bf16, frozen), train the head over 3 seeds on cached features,
    measure both frozen held-out sets and the full-task benchmark on THIS body, publish heads + results to the private repo sham2-tldm-head. Later cycles only report."""
    work = tldm_work() / "sham2"
    work.mkdir(parents=True, exist_ok=True)
    report, heads = work / "sham2_results.json", work / "sham2_heads.pt"
    key, key_file = sham2_run_key(), work / ".run_key"
    if report.exists() and (not key_file.exists() or key_file.read_text(encoding="utf-8") != key):
        # the recipe changed (identity data, config or trainer): train again; the donor copy on disk is reused (no re-download)
        print("sham2: recipe changed since the last run; retraining on the cached donor copy", flush=True)
        for f in (report, heads, work / ".published"):
            f.unlink(missing_ok=True)
    if report.exists() and (work / ".published").exists():
        if runner is None:
            time.sleep(1800)                                         # done once: later cycles only report (no retraining, no re-download)
        return {**sham2_flatten(json.loads(report.read_text(encoding="utf-8"))), "published": True, "hours": float(hours)}
    if not report.exists():
        ck, tk = sham2_donor(work, fetch)
        root = tldm_root()
        cmd = [sys.executable, "-u", str(root / "training" / "train_sham2.py"), "--config", str(root / "configs" / "sham2.yaml"),
               "--donor", str(ck), "--tokenizer", str(tk), "--gate", str(sham2_gate(root)), "--cached",
               "--dtype", os.environ.get("SHAM2_DTYPE", "bf16"), "--seeds", os.environ.get("SHAM2_SEEDS", "3"), "--loop", "--loop_seeds", "1", "--identity",
               "--out", str(heads), "--json", str(report)]
        if runner is not None:
            code = int(runner(cmd=cmd, report=report, heads=heads))
        else:
            import subprocess
            env = os.environ.copy()
            env["PYTHONPATH"] = str(root) + os.pathsep + env.get("PYTHONPATH", "")
            code = int(subprocess.run(cmd, cwd=str(root), env=env, check=False).returncode)
        if code != 0 or not report.exists():
            raise RuntimeError(f"sham2 train exited with code {code}")
        key_file.write_text(key, encoding="utf-8")
    res = json.loads(report.read_text(encoding="utf-8"))
    got = None
    try:
        snap = work / "publish_snap"
        import shutil
        shutil.rmtree(snap, ignore_errors=True)
        snap.mkdir()
        for f in (heads, report):
            if f.exists():
                shutil.copy2(f, snap / f.name)
        if publish is None:
            sys.path.insert(0, str(SHAM))
            import sham_inputs
            publish = sham_inputs.publish_modelscope
        got = publish(snap, os.environ.get("SHAM2_HEAD_REPO") or SHAM2_HEAD_REPO, "Sham 2 T-LDM heads (head only, no donor weight)")
        shutil.rmtree(snap, ignore_errors=True)
    except Exception as exc:  # noqa: BLE001 - the files stay on disk; the next cycle retries the publish
        print(f"sham2 publish failed: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
    if got:
        (work / ".published").write_text(str(got), encoding="utf-8")
    out = {**sham2_flatten(res), "published": bool(got), "hours": float(hours)}
    print("sham2 done " + json.dumps(out), flush=True)
    return out


def settings(env=None) -> dict:
    env = os.environ if env is None else env
    name = re.sub(r"[^a-z0-9]+", "-", (env.get("SHAM_TRAINER_NAME") or "ms1").lower()).strip("-") or "ms1"
    job = (env.get("SHAM_TRAINER_JOB") or "live").strip().lower()
    job = job if job in PROFILES else "live"
    default_hours = 10.0 if job == "tldm" else 5.0
    try:
        hours = min(10.0, max(0.5, float(env.get("SHAM_TRAINER_HOURS") or default_hours)))
    except ValueError:
        hours = default_hours
    try:
        workers = min(16, max(1, int(env.get("SHAM_TRAINER_WORKERS") or 2)))
    except ValueError:
        workers = 2
    return {"name": name, "hours": hours, "workers": workers, "source_set": env.get("SHAM_TRAINER_SOURCES") or "gh", "job": job}


# What the trainer printed lately, for the status page: the trainers on cn sat in "training" for 16 hours with an empty `last`, and nothing said where. Secrets are never kept:
# a line that mentions a token / key / secret / authorization is dropped, long lines are cut. Only the last TAIL_LINES lines, plus when the last line arrived.
TAIL_LINES = 40
_SECRET_LINE = re.compile(r"token|secret|password|authorization|api[_-]?key|bearer|kaggle_key", re.I)
_TAIL: list = []
_LAST_LINE_AT = [0.0]


class _Tee:
    def __init__(self, stream):
        self.stream, self.pending = stream, ""

    def write(self, text):
        try:
            self.stream.write(text)
        except Exception:  # noqa: BLE001
            pass
        self.pending += str(text)
        while "\n" in self.pending:
            line, self.pending = self.pending.split("\n", 1)
            line = line.strip()
            if line and not _SECRET_LINE.search(line):
                with _LOCK:
                    _TAIL.append(line[:220])
                    del _TAIL[:-TAIL_LINES]
                    _LAST_LINE_AT[0] = time.time()
        return len(text)

    def flush(self):
        try:
            self.stream.flush()
        except Exception:  # noqa: BLE001
            pass

    def __getattr__(self, name):
        return getattr(self.stream, name)


def _set(**kw) -> None:
    with _LOCK:
        STATE.update(kw)


def _short(res) -> dict:
    """Whitelisted numbers only: never a token, never a text."""
    keep = ("steps", "published", "corpus", "guard_score", "rollbacks", "device", "hours",
            "seed", "config", "train", "heldout", "heldout2", "train_secs", "evo_after", "evolve_kept", "loop_trained", "params_M",
            "heldout_seeds", "heldout2_seeds", "loop_all", "loop_simple", "loop_multi", "loop_s_per_task", "body_read_secs", "body_params_M", "dtype", "donor_weights_unchanged",
            "identity_before", "identity_after", "nll_before", "nll_after")
    return {k: res[k] for k in keep if isinstance(res, dict) and k in res and isinstance(res[k], (int, float, bool, str)) and len(str(res[k])) <= 80}


RESULT_MARK = "@@CYCLE_RESULT@@ "


def _resolve_run_fn(cfg: dict):
    for k, v in PROFILES[cfg["job"]].items():          # the job's shares, before sham_live is imported (it reads some of them at import time)
        os.environ.setdefault(k, v)
    # The search for a "better media tokenizer" downloads and measures every tokenizer dataset of the account: on this Studio's slow link it sat for hours with no output
    # (cn sham-trainer-1, 2026-11-13). The head adopted the best one once (2026-10-17); a trainer keeps the tokenizer that sits next to its start checkpoint.
    os.environ.setdefault("SHAM_MEDIA_TOKENIZER", "base")
    if cfg["job"] == "codec":
        return run_codec
    if cfg["job"] == "motion":
        return run_motion
    if cfg["job"] == "tldm":
        return run_sham2 if sham2_mode(cfg["name"]) else run_tldm
    sys.path.insert(0, str(SHAM))
    import sham_live
    return sham_live.run


def child_cycle() -> None:
    """One cycle in its OWN process (python app.py --cycle): an out-of-memory kill or a hang here can no longer take the Studio's web page down (502) or freeze the status forever."""
    cfg = settings()
    WORK.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("SHAM_LIVE_WORK", str(WORK))
    if cfg["job"] in LIVE_JOBS:
        os.environ.setdefault("SHAM_SAVE_EVERY_MIN", "20")          # a guarded save every 20 min (was 60 on CPU): a kill or a sleep loses at most that
        try:
            got = prepare_resume(WORK)
            if got:
                os.environ["SHAM_RESUME_DIR"] = str(got)
        except Exception as exc:  # noqa: BLE001 - a resume problem never blocks the cycle: it starts from the head as before
            print(f"resume: not used ({type(exc).__name__}: {str(exc)[:160]})", flush=True)
    run_fn = _resolve_run_fn(cfg)
    res = run_fn(hours=cfg["hours"], name=cfg["name"], source_set=cfg["source_set"], video=False, workers=cfg["workers"])
    print(RESULT_MARK + json.dumps(_short(res)), flush=True)


LEFTOVER_FILES = ("final.pt", "sham_small_tokenizer.json", "image_tokenizer.pt", "audio_tokenizer.pt", "motion_tokenizer.pt", "crawl_progress.json")


def child_publish_leftover() -> None:
    """Publish the previous cycle's best weights when they never reached the merge (2026-11-14: the cn trainer finished a cycle 11% better than its start point, but
    uploads to Kaggle from cn failed, so no dataset `sham-crawl-ms1` existed). The private ModelScope model repo is the door that works from here. A marker file
    remembers what was published, so a restart does not push the same file twice."""
    ck = WORK / "checkpoints"
    final = ck / "final.pt"
    marker = ck / ".published_to_modelscope"
    if not final.exists():
        print("leftover: no previous weights on this Studio's disk", flush=True)
        return
    if marker.exists() and marker.stat().st_mtime >= final.stat().st_mtime:
        print("leftover: the previous weights were already published", flush=True)
        return
    sys.path.insert(0, str(SHAM))
    import shutil

    import sham_inputs
    snap = WORK / "leftover_publish"
    shutil.rmtree(snap, ignore_errors=True)
    snap.mkdir(parents=True)
    for name in LEFTOVER_FILES:
        if (ck / name).exists():
            try:
                os.link(ck / name, snap / name)
            except OSError:
                shutil.copy2(ck / name, snap / name)
    # 2026-11-18 (owner: training must resume after any stop): resume.json says whether these weights belong to a cycle that was still running, so a Studio whose disk
    # was reset can continue that cycle (resume_from_modelscope) instead of starting it over.
    (snap / "resume.json").write_text(json.dumps({"cycle_running": _saved_in_running_cycle(ck), "saved_at": final.stat().st_mtime}), encoding="utf-8")
    slug = "".join(c if c.isalnum() else "-" for c in settings()["name"].lower()).strip("-")
    got = sham_inputs.publish_modelscope(snap, f"sham-crawl-{slug}", "leftover of the previous cycle")
    shutil.rmtree(snap, ignore_errors=True)
    if got:
        marker.write_text(got, encoding="utf-8")
    print(f"leftover: {'published as ' + got if got else 'NOT published (kept on disk)'}", flush=True)


def _clean_lines(text: str, limit: int = 2600) -> str:
    """The last lines of a child's output, without any line that mentions a token or a key (the status page is public to anyone who can call the Studio)."""
    keep = [ln for ln in str(text or "").splitlines() if ln.strip() and not any(w in ln.lower() for w in ("token", "key", "secret", "password"))]
    return "\n".join(keep[-20:])[-limit:]


def publish_leftover_subprocess() -> str:
    """Runs the leftover publish in its own process and returns its (cleaned) last lines; the same text goes to STATE["leftover"] so the status shows what happened."""
    import subprocess
    try:
        r = subprocess.run([sys.executable, "-u", str(Path(__file__).resolve()), "--publish-leftover"], capture_output=True, text=True, timeout=40 * 60, check=False)
        out = _clean_lines((r.stdout or "") + "\n" + (r.stderr or ""))
        if r.returncode != 0:
            out = f"exit {r.returncode}\n" + out
    except Exception as exc:  # noqa: BLE001 - never stop the trainer for this
        out = f"leftover publish failed: {type(exc).__name__}: {str(exc)[:120]}"
    _set(leftover=out[-2000:])
    print("leftover publish:\n" + out, flush=True)
    return out


def run_cycle_subprocess(cfg: dict, cmd: list | None = None, poll_s: float = 20) -> dict:
    """Run child_cycle in a subprocess (its own process group, so a kill also ends the trainers it started); copy its printed lines into the status tail; kill it when it
    overruns the wall-clock budget (hours + 40 min), when it shows no progress for SHAM_STUCK_MINUTES (no output line and no checkpoint/log written), or on a kill request."""
    import signal
    import subprocess
    deadline = time.time() + cfg["hours"] * 3600 + 40 * 60
    cmd = cmd or [sys.executable, "-u", str(Path(__file__).resolve()), "--cycle"]
    _flag_cycle(True)
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, start_new_session=True)
    _CYCLE_LINE_AT[0] = time.time()
    _KILL_REQUEST.clear()
    _set(child_pid=proc.pid, cycle_started=time.time())
    result: dict = {}
    killed = ""

    def kill_group():
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (OSError, AttributeError):
            proc.kill()

    def watchdog():
        nonlocal killed
        while proc.poll() is None:
            idle = (time.time() - progress_ts()) / 60
            if time.time() > deadline:
                killed = f"cycle killed after the {cfg['hours']} h + 40 min wall-clock budget"
            elif idle >= stuck_minutes():
                killed = f"cycle stuck: no progress for {idle:.0f} min (limit {stuck_minutes():.0f})"
            elif _KILL_REQUEST.is_set():
                killed = "cycle killed on request (kill_cycle)"
            if killed:
                print("supervisor: " + killed, flush=True)
                kill_group()
                return
            time.sleep(poll_s)

    threading.Thread(target=watchdog, daemon=True, name="trainer-watchdog").start()
    tee = _Tee(open(os.devnull, "w"))
    for line in proc.stdout:                         # type: ignore[union-attr]
        if line.startswith(RESULT_MARK):
            try:
                result = json.loads(line[len(RESULT_MARK):])
            except ValueError:
                pass
        if any(k in line for k in ("نقطة الانطلاق", "⚓", "🎯", "الرأس المنشور", "تعذّر اختيار", "تعذّر فحص")):     # where this cycle started from: kept in the status (the log tail loses it within minutes)
            STATE["start"] = (str(STATE.get("start", "")) + " | " + line.strip())[-700:].lstrip(" |")
        tee.write(line)
        _CYCLE_LINE_AT[0] = time.time()
        if line.startswith("resume: ") or line.startswith("⏯"):
            STATE["resume"] = (str(STATE.get("resume", "")) + " | " + line.strip()[:200])[-500:].lstrip(" |")
        try:
            sys.__stdout__.write(line)               # the Studio's own log keeps everything
        except Exception:  # noqa: BLE001
            pass
    code = proc.wait()
    _set(child_pid=None)
    if killed:
        raise RuntimeError(killed)
    if code != 0:
        raise RuntimeError(f"cycle process exited with code {code}" + (" (killed: out of memory?)" if code in (-9, 137) else ""))
    _flag_cycle(False)                               # a clean end: the next cycle starts fresh from the head (a crash keeps the flag, so the next one resumes)
    return result


def train_forever(run_fn=None, sleep=time.sleep, max_cycles: int | None = None) -> None:
    cfg = settings()
    WORK.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("SHAM_LIVE_WORK", str(WORK))
    in_process = run_fn is not None                    # tests inject run_fn; the real Studio runs every cycle in a child process
    if not in_process:
        for k, v in PROFILES[cfg["job"]].items():
            os.environ.setdefault(k, v)
        try:
            import torch
            _set(device="cuda" if torch.cuda.is_available() else "cpu")
        except Exception:
            pass
    if cfg["job"] == "tldm":
        if not (os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN")):
            _set(phase="blocked", error="no ModelScope token in the Studio secrets (MODELSCOPE_API_TOKEN)")
            return
    elif not (os.environ.get("KAGGLE_USERNAME") and (os.environ.get("KAGGLE_API_TOKEN") or os.environ.get("KAGGLE_KEY"))):
        _set(phase="blocked", error="no Kaggle keys in the Studio secrets (KAGGLE_USERNAME + KAGGLE_API_TOKEN)")
        return
    if not isinstance(sys.stdout, _Tee):
        sys.stdout = _Tee(sys.stdout)
    if not in_process and cfg["job"] != "tldm":
        _set(phase="publishing-leftover")
        with _PUBLISH_LOCK:
            publish_leftover_subprocess()
    cycle = 0
    fails = 0
    while max_cycles is None or cycle < max_cycles:
        cycle += 1
        STATE["start"] = ""
        STATE["resume"] = ""
        _set(phase="training", cycle=cycle, error="")
        t0 = time.time()
        try:
            res = run_fn(hours=cfg["hours"], name=cfg["name"], source_set=cfg["source_set"], video=False, workers=cfg["workers"]) if in_process else run_cycle_subprocess(cfg)
            fails = 0
            _set(phase="between-cycles", last=_short(res), last_ok=time.time(), fails_in_a_row=0)
            if not in_process and isinstance(res, dict) and res.get("published"):
                try:                                       # the cycle itself published its best weights: a restart must not push them again
                    (WORK / "checkpoints" / ".published_to_modelscope").write_text(str(res["published"])[:80], encoding="utf-8")
                except OSError:
                    pass
        except Exception as exc:   # one failed cycle never stops the next: restarted with a growing pause (1, 2, 4 ... 30 min), from the last checkpoint
            fails = 1 if time.time() - t0 > 3600 else fails + 1   # a cycle that ran for an hour before failing is not a crash loop
            wait = backoff_seconds(fails)
            _set(phase="error-retrying", error=f"{type(exc).__name__}: {str(exc)[:200]}", restarts=int(STATE.get("restarts", 0)) + 1,
                 last_failure=time.time(), retry_in_s=wait, fails_in_a_row=int(STATE.get("fails_in_a_row", 0)) + 1)
            traceback.print_exc()
            sleep(wait)
        sleep(30)


# ---- supervision (owner's order 2026-11-18: training never stops silently; anything that stops is found and restarted, and resumes from its last checkpoint) ----
LIVE_JOBS = ("live", "images", "audio", "chat", "tools", "text")      # the sham_live profiles: they save final.pt + crawl_progress.json while they train
CYCLE_FLAG = ".cycle_running"
_CYCLE_LINE_AT = [0.0]
_KILL_REQUEST = threading.Event()
_PUBLISH_LOCK = threading.Lock()


def stuck_minutes() -> float:
    try:
        return max(10.0, float(os.environ.get("SHAM_STUCK_MINUTES") or 120))
    except ValueError:
        return 120.0


def backoff_seconds(fails: int) -> int:
    return int(min(1800, 60 * 2 ** max(0, fails - 1)))


def _flag_cycle(on: bool) -> None:
    try:
        f = WORK / "checkpoints" / CYCLE_FLAG
        if on:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(str(time.time()), encoding="utf-8")
        else:
            f.unlink(missing_ok=True)
    except OSError:
        pass


def _progress_dirs() -> list:
    dirs = [WORK / "checkpoints"]
    t = os.environ.get("TLDM_WORK")
    if t:
        dirs += [Path(t) / "checkpoints", Path(t) / "checkpoints" / "loop", Path(t) / "logs", Path(t) / "sham2"]
    return dirs


def progress_ts() -> float:
    """When the running cycle last showed life: its last output line, or the newest file it wrote (top level of its checkpoint/log folders only: cheap on a slow mount)."""
    ts = max(_CYCLE_LINE_AT[0], float(STATE.get("cycle_started") or 0))
    for d in _progress_dirs():
        try:
            for f in d.iterdir():
                if f.name != CYCLE_FLAG:
                    ts = max(ts, f.stat().st_mtime)
        except OSError:
            continue
    return ts


def heartbeat() -> dict:
    now = time.time()
    with _LOCK:
        hb = {k: STATE.get(k) for k in ("phase", "cycle", "restarts", "fails_in_a_row", "last_failure", "last_ok", "error", "child_pid", "retry_in_s")}
    training = hb["phase"] == "training"
    hb.update(ts=now, job=settings()["job"], name=settings()["name"], stuck_after_min=stuck_minutes(),
              progress_age_min=round((now - progress_ts()) / 60, 1) if training else 0.0,
              supervisor_alive=any(t.name == "sham-supervisor" and t.is_alive() for t in threading.enumerate()))
    ck = WORK / "checkpoints"
    try:
        hb["checkpoint_age_min"] = round((now - (ck / "final.pt").stat().st_mtime) / 60, 1)
    except OSError:
        hb["checkpoint_age_min"] = None
    hb["saved_in_cycle"] = training and _saved_in_running_cycle(ck)
    hb["checkpoint_step"] = _live_progress(ck).get("step") if hb["saved_in_cycle"] else None
    hb["resume"] = str(STATE.get("resume") or "")[:500]
    return hb


def heartbeat_path() -> Path:
    return WORK.parent / "heartbeat.json"


def heartbeat_loop(every_s: float = 60) -> None:
    """heartbeat.json on the persistent disk (atomic replace), read by the status endpoint and by humans; the same data answers the Gradio api `heartbeat` the watchers call."""
    while True:
        try:
            p = heartbeat_path()
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps(heartbeat()), encoding="utf-8")
            os.replace(tmp, p)
        except Exception:  # noqa: BLE001
            pass
        time.sleep(every_s)


def _link_or_copy(src: Path, dst: Path) -> None:
    import shutil
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def _saved_in_running_cycle(ck: Path) -> bool:
    """True when final.pt was saved by the cycle that is (or was, when it died) running: the flag exists and final.pt is newer than the flag. A final.pt left over from an
    earlier, finished cycle is not resumed (that one already went to the merge; the new cycle must start from the head)."""
    flag = ck / CYCLE_FLAG
    try:
        try:
            started = float(flag.read_text(encoding="utf-8").strip())
        except ValueError:
            started = flag.stat().st_mtime
        return (ck / "final.pt").stat().st_mtime >= started - 2          # file clocks run a little behind time.time()
    except OSError:
        return False


def _live_progress(folder: Path) -> dict:
    try:
        d = json.loads((folder / "crawl_progress.json").read_text(encoding="utf-8"))
        return d if isinstance(d, dict) and d.get("by") == "sham_live" else {}
    except (OSError, ValueError):
        return {}


def resume_max_hours() -> float:
    try:
        return float(os.environ.get("SHAM_RESUME_MAX_HOURS") or 24)
    except ValueError:
        return 24.0


def prepare_resume(work: Path, fetch=None) -> Path | None:
    """The folder the next sham_live cycle should RESUME from, or None (= start from the published head as always).
    A cycle that was interrupted (crash, out of memory, stuck kill, Studio sleep or restart) leaves the flag .cycle_running next to its last saved final.pt + crawl_progress.json:
    those are snapshotted (hard links, else copies) into resume_local/ and the next cycle continues from them. When the Studio's disk was reset, the last weights uploaded to the
    private ModelScope repo sham-crawl-<name> (resume.json: cycle_running) are fetched instead. Older than SHAM_RESUME_MAX_HOURS: not resumed (the head has moved on)."""
    import shutil
    ck = work / "checkpoints"
    snap = work / "resume_local"
    if (os.environ.get("SHAM_RESUME") or "1").strip().lower() in ("0", "off", "false", "no"):
        return None
    max_age = resume_max_hours() * 3600
    if _saved_in_running_cycle(ck) and _live_progress(ck):
        if time.time() - (ck / "final.pt").stat().st_mtime > max_age:
            print("resume: the interrupted cycle's checkpoint is too old: starting from the head", flush=True)
            return None
        shutil.rmtree(snap, ignore_errors=True)
        snap.mkdir(parents=True)
        for f in ck.iterdir():
            if f.is_file() and f.name != CYCLE_FLAG and not f.name.endswith(".tmp"):
                _link_or_copy(f, snap / f.name)
        print(f"resume: continuing the interrupted cycle from its last checkpoint on disk (step {_live_progress(snap).get('step')})", flush=True)
        return snap
    if (ck / "final.pt").exists():
        return None                                                            # the disk is there and the last cycle ended cleanly: the head, as always
    got = (fetch or resume_from_modelscope)(snap)
    if got and (got / "final.pt").is_file() and _live_progress(got):
        try:
            meta = json.loads((got / "resume.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            meta = {}
        if meta.get("cycle_running") and time.time() - float(meta.get("saved_at") or 0) <= max_age:
            print(f"resume: this Studio's disk was empty; continuing from the last checkpoint uploaded to ModelScope (step {_live_progress(got).get('step')})", flush=True)
            return got
    shutil.rmtree(snap, ignore_errors=True)
    return None


def resume_from_modelscope(dest: Path) -> Path | None:
    """Download <owner>/sham-crawl-<name> (private, written by child_publish_leftover) into dest. None when it does not exist or cannot be reached."""
    import shutil
    try:
        from modelscope import snapshot_download
        owner = os.environ.get("SHAM_MS_OWNER") or "novaai2026"
        slug = "".join(c if c.isalnum() else "-" for c in settings()["name"].lower()).strip("-")
        cache = dest.parent / "resume_ms_cache"
        src = Path(snapshot_download(f"{owner}/sham-crawl-{slug}", cache_dir=str(cache)))
        shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True)
        for f in src.iterdir():
            if f.is_file():
                shutil.move(str(f), dest / f.name)
        shutil.rmtree(cache, ignore_errors=True)
        return dest
    except Exception as exc:  # noqa: BLE001
        print(f"resume: no copy on ModelScope ({type(exc).__name__}: {str(exc)[:120]})", flush=True)
        return None


def checkpoint_upload_loop(sleep=time.sleep) -> None:
    """Every SHAM_CKPT_UPLOAD_HOURS (default 2) the newest saved weights go to the private ModelScope repo sham-crawl-<name> (only when they changed since the last upload),
    so a rebuilt or reset Studio can resume from them. Same door as the leftover publish; it runs in its own process."""
    try:
        every = max(0.25, float(os.environ.get("SHAM_CKPT_UPLOAD_HOURS") or 2)) * 3600
    except ValueError:
        every = 7200
    while True:
        sleep(every)
        ck = WORK / "checkpoints"
        final, marker = ck / "final.pt", ck / ".published_to_modelscope"
        if not final.exists() or (marker.exists() and marker.stat().st_mtime >= final.stat().st_mtime):
            continue
        with _PUBLISH_LOCK:
            publish_leftover_subprocess()


def supervise(sleep=time.sleep, run=None, max_rounds: int | None = None) -> None:
    """Keeps train_forever alive: if it ever raises (or returns: blocked by missing secrets), it is started again after a pause. The Studio's web page never depends on it."""
    run = run or train_forever
    rounds, fails = 0, 0
    while max_rounds is None or rounds < max_rounds:
        rounds += 1
        try:
            run()
            fails = 0
        except Exception as exc:  # noqa: BLE001
            fails += 1
            _set(phase="error-retrying", error=f"supervisor: {type(exc).__name__}: {str(exc)[:200]}", restarts=int(STATE.get("restarts", 0)) + 1)
            traceback.print_exc()
        sleep(backoff_seconds(fails) if fails else 600)


def kill_cycle() -> str:
    """Hidden, private-Studio API (bearer token): kill the running cycle; the supervisor restarts it and it resumes from its last checkpoint. Used to verify that path."""
    pid = STATE.get("child_pid")
    if not pid:
        return json.dumps({"killed": False, "why": "no cycle running", "phase": STATE.get("phase")})
    _KILL_REQUEST.set()
    return json.dumps({"killed": True, "pid": pid})


def status_json() -> str:
    with _LOCK:
        quiet = round((time.time() - _LAST_LINE_AT[0]) / 60) if _LAST_LINE_AT[0] else None
        state = dict(STATE)
    return json.dumps({**state, "settings": {k: v for k, v in settings().items()}, "tail": list(_TAIL[-25:]), "minutes_since_last_line": quiet, "heartbeat": heartbeat()}, ensure_ascii=False)


def studio_launch_kwargs() -> dict:
    return {"server_name": "0.0.0.0", "server_port": int(os.environ.get("PORT") or 7860), "share": False, "ssr_mode": False}


def launch_studio(demo, launch=None) -> None:
    """Bind the Gradio app on the Studio port. Never use share=True (that would publish a public link).
    Some Studio sandboxes cannot open 127.0.0.1, so Gradio's post-bind health check raises even though the
    server is already listening on 0.0.0.0 — keep the process alive instead of crashing the deploy."""
    for key in ("NO_PROXY", "no_proxy"):
        cur = os.environ.get(key) or ""
        extra = "127.0.0.1,localhost,::1"
        if "127.0.0.1" not in cur.replace(" ", ""):
            os.environ[key] = (cur + "," + extra).strip(",") if cur else extra
    fn = launch or getattr(demo, "launch")
    try:
        fn(**studio_launch_kwargs())
    except ValueError as exc:
        if "localhost is not accessible" not in str(exc):
            raise
        print("gradio localhost check failed; app already listening on 0.0.0.0:" + str(studio_launch_kwargs()["server_port"]), flush=True)
        if launch is None:
            while True:
                time.sleep(3600)


def main() -> None:
    import gradio as gr
    threading.Thread(target=supervise, daemon=True, name="sham-supervisor").start()
    threading.Thread(target=heartbeat_loop, daemon=True, name="sham-heartbeat").start()
    if settings()["job"] in LIVE_JOBS:
        threading.Thread(target=checkpoint_upload_loop, daemon=True, name="sham-ckpt-upload").start()
    try:                                                   # watch the other trainer Studios and sham-runner-1 (both sites): any one that sleeps or dies is started again
        sys.path.insert(0, str(HERE))
        import studio_guard
        studio_guard.start_thread()
    except Exception as exc:  # noqa: BLE001
        print(f"studio guard not started: {type(exc).__name__}: {exc}", flush=True)
    with gr.Blocks(title="Sham trainer") as demo:
        gr.Markdown("Sham live trainer — status only (the work runs in the background).")
        out = gr.Textbox(label="status", interactive=False)
        gr.Button("refresh").click(status_json, None, out, api_name="status")
        gr.Button("heartbeat", visible=False).click(lambda: json.dumps(heartbeat()), None, out, api_name="heartbeat")
        gr.Button("kill cycle", visible=False).click(kill_cycle, None, out, api_name="kill_cycle")
        gr.Button("publish", visible=False).click(lambda: publish_leftover_subprocess(), None, out, api_name="publish_now")   # retry the leftover publish without a redeploy
    launch_studio(demo)


if __name__ == "__main__":
    if "--cycle" in sys.argv:
        child_cycle()
        sys.exit(0)
    if "--publish-leftover" in sys.argv:
        child_publish_leftover()
        sys.exit(0)
    if "--selftest" in sys.argv:
        assert settings({})["name"] == "ms1" and settings({"SHAM_TRAINER_NAME": "MS 2!"})["name"] == "ms-2"
        assert settings({"SHAM_TRAINER_HOURS": "99"})["hours"] == 10.0 and settings({"SHAM_TRAINER_HOURS": "x"})["hours"] == 5.0
        assert settings({"SHAM_TRAINER_JOB": "Images"})["job"] == "images" and settings({"SHAM_TRAINER_JOB": "zzz"})["job"] == "live"
        assert set(PROFILES) == {"live", "images", "audio", "chat", "tools", "text", "codec", "motion", "tldm"}
        assert settings({"SHAM_TRAINER_JOB": "tldm"})["job"] == "tldm" and settings({"SHAM_TRAINER_JOB": "tldm"})["hours"] == 10.0
        assert settings({"SHAM_TRAINER_JOB": "tldm", "SHAM_TRAINER_HOURS": "3"})["hours"] == 3.0
        assert tldm_sidecars_ok(), tldm_sidecars()     # repo layout: ai-system/{tldm,terminal,distill}; the Studio deploy copies the same siblings
        calls = []

        def fake(**kw):
            calls.append(kw)
            if len(calls) == 1:
                raise RuntimeError("boom")
            return {"steps": 12, "published": True, "secret": "never"}
        os.environ.update(KAGGLE_USERNAME="u", KAGGLE_API_TOKEN="t")
        train_forever(fake, sleep=lambda s: None, max_cycles=2)
        assert len(calls) == 2 and calls[0]["video"] is False and STATE["last"] == {"steps": 12, "published": True}, (calls, STATE)
        del os.environ["KAGGLE_API_TOKEN"]
        train_forever(fake, sleep=lambda s: None, max_cycles=1)
        assert STATE["phase"] == "blocked"
        t = _Tee(open(os.devnull, "w"))
        t.write("hello\nkaggle token abc\nsecond line\n" + "x" * 500 + "\n")
        assert _TAIL[-3:] == ["hello", "second line", "x" * 220] and "abc" not in "".join(_TAIL), _TAIL
        assert json.loads(status_json())["tail"][-1] == "x" * 220
        import tempfile
        import types
        WORK = Path(tempfile.mkdtemp())
        (WORK / "checkpoints").mkdir()
        sent = []
        fake_inputs = types.ModuleType("sham_inputs")
        fake_inputs.publish_modelscope = lambda folder, name, message: (sent.append((name, sorted(p.name for p in Path(folder).iterdir()))), "modelscope:acct/" + name)[1]
        sys.modules["sham_inputs"] = fake_inputs
        child_publish_leftover()                                         # no weights yet: nothing is sent
        assert sent == [], sent
        (WORK / "checkpoints" / "final.pt").write_bytes(b"w")
        (WORK / "checkpoints" / "sham_small_tokenizer.json").write_text("{}")
        (WORK / "checkpoints" / "crawl_progress.json").write_text("{}")
        child_publish_leftover()
        assert sent == [("sham-crawl-ms1", ["crawl_progress.json", "final.pt", "resume.json", "sham_small_tokenizer.json"])], sent
        child_publish_leftover()                                         # already published: not twice
        assert len(sent) == 1, sent
        # tldm job: donor head is the main cycle; optional evolve is off by default; publish to tldm-writer-runs; no network
        tldm_tmp = Path(tempfile.mkdtemp())
        os.environ["TLDM_WORK"] = str(tldm_tmp)
        os.environ["SHAM_TRAINER_JOB"] = "tldm"
        os.environ["MODELSCOPE_API_TOKEN"] = "t"
        os.environ["SHAM_MS_OWNER"] = "Jonjithup"
        os.environ["SITE"] = "ai"
        os.environ.pop("KAGGLE_API_TOKEN", None)
        os.environ.pop("SHAM_TLDM_EVOLVE", None)
        tldm_arms = []

        def fake_tldm(**kw):
            seed, work = kw["seed"], kw["work"]
            cmd = kw.get("cmd") or []
            (work / "checkpoints" / "loop").mkdir(parents=True, exist_ok=True)
            (work / "logs").mkdir(parents=True, exist_ok=True)
            script = tldm_script(cmd) if cmd else (kw.get("arm") or "")
            tldm_arms.append((seed, script, kw.get("arm")))
            if script == "train_0.3b.py" or kw.get("arm") == "donor":
                Path(tldm_cmd_opt(cmd, "--out") or kw.get("ckpt")).write_bytes(b"w")
                Path(tldm_cmd_opt(cmd, "--json") or kw.get("report")).write_text(json.dumps({
                    "config": "writer_donor.yaml", "seed": seed, "train_secs": 1,
                    "train": {"same_effect": 0.9, "exact_text": 0.8},
                    "heldout": {"same_effect": 0.5, "exact_text": 0.4},
                    "heldout2": {"same_effect": 0.4, "exact_text": 0.3},
                }), encoding="utf-8")
            elif script == "train_loop.py" or kw.get("arm") == "loop":
                Path(tldm_cmd_opt(cmd, "--out") or kw.get("ckpt")).write_bytes(b"loop")
            elif kw.get("arm") == "safe_evolve":
                ev = {"kept": False, "reason": "no verified successes among retries (nothing safe to learn); adapter not kept",
                      "before": {"C": {"rate": 1.0}, "eval60_778": {"episode_success": 0.8}}, "verified_pairs": 0}
                Path(kw["report"]).write_text(json.dumps(ev), encoding="utf-8")
                return ev
            return 0

        sent_tldm = []
        fake_inputs.publish_modelscope = lambda folder, name, message: (sent_tldm.append((name, sorted(p.name for p in Path(folder).iterdir()), message)), "modelscope:Jonjithup/" + name)[1]
        first = run_tldm(runner=fake_tldm)
        second = run_tldm(runner=fake_tldm)
        assert first["seed"] == 0 and second["seed"] == 1, (first, second)
        assert first["heldout"] == 0.5 and first["heldout2"] == 0.4 and first["train"] == 0.9 and first["published"] is True
        assert first["config"] == "writer_donor.yaml"
        assert [a[1] for a in tldm_arms] == ["train_0.3b.py", "train_0.3b.py"], tldm_arms  # evolve is off; only the donor head
        assert sent_tldm[0][0] == "tldm-writer-runs" and "donor_seed0.pt" in sent_tldm[0][1] and "latest.json" in sent_tldm[0][1]
        assert (tldm_tmp / "logs" / "results.jsonl").read_text(encoding="utf-8").count("\n") == 2
        assert tldm_next_seed(tldm_tmp) == 2
        # optional evolve: 0 verified pairs -> adapter not kept; previously-correct regression is refused
        from safe_evolve import anonymize_record, load_session_pairs, no_regress
        assert no_regress({"C": {"rate": 1.0}, "eval60_778": {"episode_success": 0.8}},
                          {"C": {"rate": 1.0}, "eval60_778": {"episode_success": 0.8}})[0]
        assert not no_regress({"C": {"rate": 1.0}, "eval60_778": {"episode_success": 0.8}},
                              {"C": {"rate": 0.182}, "eval60_778": {"episode_success": 0.8}})[0]
        cleaned = anonymize_record({"task": "t", "ref_reply": "ok", "ref_snap": "s", "steps": [[0, "ok"]],
                                    "user_id": "u1", "email": "a@b.c", "session_id": "s1", "ip": "1.2.3.4", "verified": True})
        assert cleaned == {"task": "t", "ref_reply": "ok", "ref_snap": "s", "steps": [[0, "ok"]]}
        assert anonymize_record({"task": "t", "user_id": "u1", "verified": False}) is None
        sess = Path(tempfile.mkdtemp()) / "sessions.jsonl"
        sess.write_text(json.dumps({"task": "t", "ref_reply": "ok", "steps": [[0, "ok"]], "user_id": "u1", "verified": True}) + "\n", encoding="utf-8")
        loaded = load_session_pairs(sess)
        assert loaded == [{"task": "t", "ref_reply": "ok", "steps": [[0, "ok"]]}] and "user_id" not in loaded[0]
        os.environ["SHAM_TLDM_EVOLVE"] = "1"
        tldm_arms.clear()
        ev_tmp = Path(tempfile.mkdtemp())
        os.environ["TLDM_WORK"] = str(ev_tmp)
        ev_cycle = run_tldm(runner=fake_tldm)
        assert ev_cycle["published"] is True and ev_cycle.get("evolve_kept") is False
        assert "train_loop.py" in [a[1] for a in tldm_arms] and any(a[2] == "safe_evolve" for a in tldm_arms), tldm_arms
        os.environ.pop("SHAM_TLDM_EVOLVE", None)
        os.environ["TLDM_WORK"] = str(tldm_tmp)
        # international hub host lives in the shared ms_hub helper
        sys.modules.pop("sham_inputs", None)
        sys.path.insert(0, str(HERE.parent / "colab" / "sham_small"))
        import ms_hub  # noqa: E402
        saved_env = {k: os.environ.pop(k, None) for k in ("MODELSCOPE_DOMAIN", "SITE", "SHAM_MS_OWNER", "MODELSCOPE_HUB_ENDPOINT")}
        assert ms_hub.ms_hub_endpoint() is None
        os.environ["SHAM_MS_OWNER"] = "Jonjithup"
        assert ms_hub.ms_hub_endpoint() == "www.modelscope.ai"
        os.environ.pop("SHAM_MS_OWNER")
        os.environ["SITE"] = "ai"
        assert ms_hub.ms_hub_endpoint() == "www.modelscope.ai"
        os.environ["MODELSCOPE_DOMAIN"] = "www.modelscope.cn"
        assert ms_hub.ms_hub_endpoint() == "www.modelscope.cn"
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        sys.modules["sham_inputs"] = fake_inputs
        STATE.update(phase="starting", error="")
        tldm_ok = []
        train_forever(lambda **kw: (tldm_ok.append(kw), {"seed": 0, "heldout": 0.5, "published": True})[1], sleep=lambda s: None, max_cycles=1)
        assert tldm_ok and STATE["phase"] == "between-cycles" and STATE["last"]["heldout"] == 0.5, (tldm_ok, STATE)
        del os.environ["MODELSCOPE_API_TOKEN"]
        train_forever(lambda **kw: {"seed": 0}, sleep=lambda s: None, max_cycles=1)
        assert STATE["phase"] == "blocked" and "ModelScope" in STATE["error"], STATE
        os.environ.pop("SHAM_TRAINER_JOB", None)
        os.environ.pop("TLDM_WORK", None)
        os.environ.pop("SITE", None)
        os.environ.pop("SHAM_MS_OWNER", None)
        # sham2 job (job=tldm, name=sham2): donor copy once, train_sham2 --cached, publish heads to sham2-tldm-head, then only report
        os.environ["TLDM_WORK"] = str(Path(tempfile.mkdtemp()))
        assert settings({"SHAM_TRAINER_JOB": "tldm", "SHAM_TRAINER_NAME": "sham2"})["name"] == "sham2" and sham2_mode("sham2") and not sham2_mode("ms1")
        assert "site=cn" in sham2_hub_check({"MODELSCOPE_DOMAIN": "www.modelscope.ai", "MODELSCOPE_API_TOKEN": "x"}) and "cn Studio" in sham2_hub_check({"SITE": "ai", "MODELSCOPE_API_TOKEN": "x"})
        assert sham2_hub_check({"MODELSCOPE_API_TOKEN": "x"}) == "" and "token" in sham2_hub_check({})
        fetched, ran, sent2 = [], [], []

        def fake_fetch(repo, dest):
            fetched.append(repo)
            (dest / "final_merged.pt").write_bytes(b"x")
            (dest / "sham_small_tokenizer.json").write_text("{}", encoding="utf-8")

        _cd = Path(tempfile.mkdtemp()) / "donor"
        (_cd / "novaai2026").mkdir(parents=True)
        (_cd / "novaai2026" / "final_merged.pt").write_bytes(b"x" * 10)
        sham2_check_sizes("r", _cd, files=[("final_merged.pt", 10)])
        try:
            sham2_check_sizes("r", _cd, files=[("final_merged.pt", 11), ("sham_small_tokenizer.json", 5)])
            raise AssertionError("a truncated donor copy must not pass")
        except RuntimeError as exc:
            assert "incomplete" in str(exc) and "missing" in str(exc)

        def fake_sham2(cmd, report, heads):
            ran.append(cmd)
            assert "--cached" in cmd and "--loop" in cmd and "--identity" in cmd and cmd[cmd.index("--dtype") + 1] == "bf16" and "tldm_heldout_gate_2026-11-18.json" in cmd[cmd.index("--gate") + 1]
            heads.write_bytes(b"h")
            report.write_text(json.dumps({"train": {"same_effect": 0.9}, "heldout": {"same_effect": 0.7}, "heldout2": {"same_effect": 0.65}, "donor_weights_unchanged": True,
                                          "writer": [{"heldout": {"same_effect": 0.7}, "heldout2": {"same_effect": 0.65}}],
                                          "loop": [{"all": {"success": 0.9, "median_s_per_task": 2.0}, "simple": {"success": 0.95}, "multi_step": {"success": 0.8}}]}), encoding="utf-8")
            return 0
        r1 = run_sham2(runner=fake_sham2, fetch=fake_fetch, publish=lambda d, n, m: (sent2.append((n, sorted(p.name for p in Path(d).iterdir()))), "modelscope:novaai2026/" + n)[1])
        r2 = run_sham2(runner=fake_sham2, fetch=fake_fetch, publish=lambda d, n, m: None)
        assert fetched == ["novaai2026/sham-v2"] and len(ran) == 1, (fetched, ran)
        assert sent2 == [("sham2-tldm-head", ["sham2_heads.pt", "sham2_results.json"])] and r1["published"] and r2["heldout"] == 0.7 and r2["loop_multi"] == 0.8
        assert _short(r1)["heldout_seeds"] == "0.7" and _short(r1)["loop_all"] == 0.9
        _w2 = tldm_work() / "sham2"
        (_w2 / ".run_key").write_text("old-recipe", encoding="utf-8")                # identity data / config / trainer changed -> retrain, donor copy reused
        r3 = run_sham2(runner=fake_sham2, fetch=fake_fetch, publish=lambda d, n, m: "modelscope:novaai2026/" + n)
        assert len(ran) == 2 and fetched == ["novaai2026/sham-v2"] and r3["published"] and (_w2 / ".run_key").read_text(encoding="utf-8") == sham2_run_key()
        os.environ.pop("TLDM_WORK", None)
        # ---- supervision: backoff, stuck kill (whole process group), kill request, clean end, resume ----
        assert [backoff_seconds(n) for n in (1, 2, 3, 9)] == [60, 120, 240, 1800]
        import subprocess as _sp
        WORK = Path(tempfile.mkdtemp())
        (WORK / "checkpoints").mkdir()
        os.environ.pop("TLDM_WORK", None)
        _real_stuck = stuck_minutes
        stuck_minutes = lambda: 0.02                                                   # noqa: E731  (1.2 s without a line or a file)
        pidfile = WORK / "grandchild.pid"
        hang = [sys.executable, "-u", "-c", "import subprocess,sys,time;p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(600)']);"
                f"open({str(pidfile)!r},'w').write(str(p.pid));print('started',flush=True);time.sleep(600)"]
        t0 = time.time()
        try:
            run_cycle_subprocess({"hours": 1.0}, cmd=hang, poll_s=0.2)
            raise SystemExit("a stuck cycle must be killed")
        except RuntimeError as exc:
            assert "stuck" in str(exc), exc
        assert time.time() - t0 < 30 and (WORK / "checkpoints" / CYCLE_FLAG).exists()   # killed; the flag stays so the next cycle resumes
        time.sleep(0.3)
        gpid = int(pidfile.read_text())
        try:
            os.kill(gpid, 0)
            alive = _sp.run(["ps", "-o", "stat=", "-p", str(gpid)], capture_output=True, text=True).stdout.strip()
            assert alive.startswith("Z") or not alive, f"grandchild {gpid} survived: {alive}"
        except ProcessLookupError:
            pass
        stuck_minutes = _real_stuck
        chatty = [sys.executable, "-u", "-c", "import time\nwhile True:\n print('step',flush=True); time.sleep(0.1)"]
        threading.Timer(0.8, kill_cycle).start()
        try:
            run_cycle_subprocess({"hours": 1.0}, cmd=chatty, poll_s=0.2)
            raise SystemExit("kill_cycle must stop the cycle")
        except RuntimeError as exc:
            assert "on request" in str(exc), exc
        assert json.loads(kill_cycle())["killed"] is False
        ok = run_cycle_subprocess({"hours": 1.0}, cmd=[sys.executable, "-c", f"print({RESULT_MARK!r} + '{{\"steps\": 3}}')"], poll_s=0.2)
        assert ok == {"steps": 3} and not (WORK / "checkpoints" / CYCLE_FLAG).exists(), ok
        ck = WORK / "checkpoints"
        (ck / "final.pt").write_bytes(b"w1")
        (ck / "sham_small_tokenizer.json").write_text("{}")
        (ck / "crawl_progress.json").write_text(json.dumps({"by": "sham_live", "step": 77}))
        assert prepare_resume(WORK, fetch=lambda d: None) is None                       # the last cycle ended cleanly: start from the head
        _flag_cycle(True)
        os.utime(ck / "final.pt", (time.time() - 60,) * 2)
        assert prepare_resume(WORK) is None                                              # final.pt is from the cycle BEFORE: not resumed
        os.utime(ck / "final.pt", None)
        snap = prepare_resume(WORK)
        assert snap and (snap / "final.pt").read_bytes() == b"w1" and _live_progress(snap)["step"] == 77 and not (snap / CYCLE_FLAG).exists()
        os.utime(ck / "final.pt", (time.time() - 30 * 3600,) * 2)
        assert prepare_resume(WORK) is None                                              # older than a day: the head has moved on
        import shutil as _sh
        _sh.rmtree(ck)
        ck.mkdir()

        def fake_ms(dest, running=True, age=60):
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "final.pt").write_bytes(b"ms")
            (dest / "crawl_progress.json").write_text(json.dumps({"by": "sham_live", "step": 5}))
            (dest / "resume.json").write_text(json.dumps({"cycle_running": running, "saved_at": time.time() - age}))
            return dest
        got = prepare_resume(WORK, fetch=fake_ms)
        assert got and (got / "final.pt").read_bytes() == b"ms"                          # a reset disk resumes from the ModelScope copy
        assert prepare_resume(WORK, fetch=lambda d: fake_ms(d, running=False)) is None
        hb = heartbeat()
        assert set(hb) >= {"phase", "progress_age_min", "ts", "restarts", "supervisor_alive", "saved_in_cycle", "checkpoint_step", "resume"}, hb
        rounds = []
        supervise(sleep=lambda s: rounds.append(s), run=lambda: (_ for _ in ()).throw(RuntimeError("x")), max_rounds=3)
        assert rounds == [60, 120, 240] and STATE["restarts"] >= 3, rounds
        # Gradio on the Studio must stay private (share=False) and must not crash the process if 127.0.0.1 is blocked
        assert studio_launch_kwargs()["share"] is False and studio_launch_kwargs()["server_name"] == "0.0.0.0"
        launched = []
        def boom(**kw):
            launched.append(kw)
            raise ValueError("When localhost is not accessible, a shareable link must be created. Please set share=True")
        launch_studio(object(), launch=boom)
        assert launched and launched[0]["share"] is False and launched[0]["ssr_mode"] is False
        try:
            launch_studio(object(), launch=lambda **kw: (_ for _ in ()).throw(ValueError("other")))
            raise SystemExit("launch_studio must re-raise unknown ValueError")
        except ValueError as exc:
            assert "other" in str(exc)
        # donor is ready only with config.json AND a weight file >400 MB; a truncated leftover is replaced
        saved_donor = os.environ.pop("TLDM_DONOR", None)
        inc = Path(tempfile.mkdtemp()) / "minilm"
        inc.mkdir(parents=True)
        (inc / "config.json").write_text("{}", encoding="utf-8")
        assert donor_ready(inc) is False and donor_weight_size(inc) == 0
        (inc / "model.safetensors").write_bytes(b"x" * 1024)
        assert donor_ready(inc) is False and donor_weight_size(inc) == 1024
        os.environ["TLDM_DONOR"] = str(inc)
        ensure_donor(inc.parent, download=False)
        # download=False must not treat the truncated copy as ready and must not wipe it
        assert (inc / "model.safetensors").stat().st_size == 1024
        ok = Path(tempfile.mkdtemp()) / "minilm"
        ok.mkdir()
        (ok / "config.json").write_text("{}", encoding="utf-8")
        with (ok / "model.safetensors").open("wb") as f:
            f.truncate(DONOR_WEIGHT_MIN + 1)
        assert donor_ready(ok) and donor_weight_size(ok) == DONOR_WEIGHT_MIN + 1
        os.environ["TLDM_DONOR"] = str(ok)
        ensure_donor(ok.parent, download=False)
        # truncated dest file is replaced when the source is larger
        src, dst = Path(tempfile.mkdtemp()) / "s", Path(tempfile.mkdtemp()) / "d"
        src.mkdir(); dst.mkdir()
        (src / "model.safetensors").write_bytes(b"complete-weight")
        (dst / "model.safetensors").write_bytes(b"trunc")
        _copy_donor_tree(src, dst)
        assert (dst / "model.safetensors").read_bytes() == b"complete-weight"
        if saved_donor is None:
            os.environ.pop("TLDM_DONOR", None)
        else:
            os.environ["TLDM_DONOR"] = saved_donor
        print("modelscope-trainer app self-test OK")


        sys.exit(0)
    main()
