"""sham-runner: the always-on replacement for the modelscope.ai CPU notebook (owner's order 2026-11-18: the notebook stays stopped; everything moves to free 16 GB Studios).

A private Gradio Studio that, in background threads:
  1. restores the notebook's data once into its persistent disk /mnt/workspace from the PRIVATE ModelScope repo SHAM_RESTORE_REPO (written by scripts/notebook-node/backup_workspace.sh):
     every part is checked against the manifest's sha256 before it is unpacked; an item is marked done in /mnt/workspace/.restore/ and never fetched again.
  2. runs a GitHub Actions self-hosted runner for jonsnow-org/Ttbik with the label `studio` (notebook-task.yml target=studio). It registers once with the one-hour registration token in
     the Studio secret GH_RUNNER_REG_TOKEN (set by deploy-studio-runner.yml); the runner keeps its own credentials on the persistent disk, so restarts and wake-ups need no token.
     The runner process is restarted if it exits. The status page says plainly when registration is missing (no silent fallback).
Secrets (Studio): MODELSCOPE_API_TOKEN (read the private backup), GH_RUNNER_REG_TOKEN, SHAM_RESTORE_REPO, GH_RUNNER_NAME. Nothing here prints a secret. Offline self-test: python app.py --selftest
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import threading
import time
from pathlib import Path

DISK = Path(os.environ.get("SHAM_RUNNER_DISK") or "/mnt/workspace")
if not (DISK.is_dir() and os.access(DISK, os.W_OK)):
    DISK = Path.home() / "workspace"        # shown on the status page as disk: it is NOT persistent, so a restart re-restores and re-registers
# /mnt/workspace on an international Studio is an ossfs (OSS object storage) mount: persistent but far too slow for the runner's thousands of small files and its job work dirs
# (read from the run log 2026-11-18: the first deploy never finished unpacking there). So the runner lives on the container's local disk and only its 3 small credential files are
# kept on the persistent mount, copied back at every start: a restart or wake-up re-downloads the runner (~200 MB) but never needs a new registration token.
RUNNER_DIR = Path(os.environ.get("GH_RUNNER_DIR") or (Path.home() / "gh_runner"))
RUNNER_CFG = DISK / "gh_runner_cfg"
CFG_FILES = (".runner", ".credentials", ".credentials_rsaparams")
RESTORE_DIR = DISK / ".restore"
REPO_URL = "https://github.com/jonsnow-org/Ttbik"
RUNNER_VERSION = os.environ.get("GH_RUNNER_VERSION") or "2.338.2"     # set by the deploy workflow to the latest release; self-update is off (it would hit github.com downloads again)
STATE = {"disk": str(DISK), "started": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "restore": "waiting", "restored": {}, "runner": "waiting", "runner_restarts": 0, "error": ""}
_LOCK = threading.Lock()


def _set(**kw):
    with _LOCK:
        STATE.update(kw)
    print("[sham-runner]", json.dumps({k: v for k, v in kw.items() if k in ("restore", "runner", "runner_restarts", "guard")}, ensure_ascii=False)[:400], flush=True)     # visible in the Studio's run log


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def plan_restore(manifest: dict, done: set) -> list:
    """Items still to restore, smallest first (so the code and state land before the big caches)."""
    items = [(k, v) for k, v in (manifest.get("items") or {}).items() if k not in done]
    return sorted(items, key=lambda kv: kv[1].get("bytes", 0))


def target_name(key: str) -> str:
    """data__X (from the notebook's NAS /mnt/data) is unpacked under /mnt/workspace/nas_data/; everything else at the top of /mnt/workspace, as on the notebook."""
    return "nas_data" if key.startswith("data__") else ""


def restore_once():
    repo = (os.environ.get("SHAM_RESTORE_REPO") or "").strip()
    tok = os.environ.get("MODELSCOPE_API_TOKEN") or ""
    if not repo:
        _set(restore="not configured (no SHAM_RESTORE_REPO)")
        return
    os.environ.setdefault("MODELSCOPE_DOMAIN", "www.modelscope.ai")
    RESTORE_DIR.mkdir(parents=True, exist_ok=True)
    done = {p.stem for p in RESTORE_DIR.glob("*.ok")}
    try:
        from modelscope.hub.file_download import model_file_download
        man_path = model_file_download(repo, "manifest.json", local_dir=str(RESTORE_DIR / "dl"), token=tok)
        manifest = json.loads(Path(man_path).read_text())
    except Exception as exc:  # noqa: BLE001
        _set(restore=f"manifest not readable: {type(exc).__name__}: {str(exc)[:160]}")
        return
    todo = plan_restore(manifest, done)
    _set(restored={k: "done" for k in done})
    for key, entry in todo:
        need = entry.get("bytes", 0) * 2.1
        free = shutil.disk_usage(DISK).free
        if free < need:
            STATE["restored"][key] = f"SKIPPED: needs {need / 2**30:.1f} GB free, disk has {free / 2**30:.1f} GB"
            continue
        STATE["restored"][key] = "downloading"
        dl = RESTORE_DIR / "dl" / key
        dl.mkdir(parents=True, exist_ok=True)
        ok = True
        files = []
        for part in entry["parts"]:
            p = Path(model_file_download(repo, part["path"], local_dir=str(dl), token=tok))
            if p.stat().st_size != part["size"] or sha256_file(p) != part["sha256"]:
                STATE["restored"][key] = f"BAD part {part['path']} (size/sha256 mismatch)"
                ok = False
                break
            files.append(p)
        if ok:
            STATE["restored"][key] = "unpacking"
            root = DISK / target_name(key)
            root.mkdir(parents=True, exist_ok=True)
            cat = subprocess.Popen(["cat", *map(str, files)], stdout=subprocess.PIPE)
            with tarfile.open(fileobj=cat.stdout, mode="r|") as tf:
                for m in tf:
                    dest = (root / m.name).resolve()
                    if not str(dest).startswith(str(root.resolve())):
                        continue
                    tf.extract(m, root, **({'filter': 'tar'} if hasattr(tarfile, 'tar_filter') else {}))
            cat.wait()
            (RESTORE_DIR / f"{key}.ok").write_text(json.dumps({"bytes": entry.get("bytes"), "at": time.time()}))
            STATE["restored"][key] = "done"
        print("[sham-runner] restore", key, STATE["restored"][key], flush=True)
        shutil.rmtree(dl, ignore_errors=True)
    bad = [k for k, v in STATE["restored"].items() if v != "done"]
    _set(restore="complete" if not bad else f"incomplete: {', '.join(bad)}")
    (RESTORE_DIR / "status.json").write_text(json.dumps(STATE["restored"], indent=1))


def _runner_env() -> dict:
    env = dict(os.environ)
    env["RUNNER_ALLOW_RUNASROOT"] = "1"
    env.setdefault("DOTNET_SYSTEM_GLOBALIZATION_INVARIANT", "1")     # the Studio image may lack libicu
    for k in ("GH_RUNNER_REG_TOKEN", "MODELSCOPE_API_TOKEN", "KAGGLE_API_TOKEN"):
        env.pop(k, None)                                               # jobs get their secrets from GitHub, not from the Studio
    return env


def install_runner() -> bool:
    if (RUNNER_DIR / "run.sh").exists():
        return True
    RUNNER_DIR.mkdir(parents=True, exist_ok=True)
    _set(runner_disk=str(RUNNER_DIR), runner_free_gb=round(shutil.disk_usage(RUNNER_DIR).free / 2**30, 1))
    url = f"https://github.com/actions/runner/releases/download/v{RUNNER_VERSION}/actions-runner-linux-x64-{RUNNER_VERSION}.tar.gz"
    _set(runner=f"downloading runner v{RUNNER_VERSION}")
    tgz = RUNNER_DIR / "r.tgz"
    mirror = (os.environ.get("GH_RUNNER_MIRROR") or "").strip()
    try:
        if mirror:      # github.com release downloads hang from this Studio (read 2026-11-18: 10+ min, no byte); the deploy workflow mirrors the tarball to a private ModelScope repo
            from modelscope.hub.file_download import model_file_download
            got = model_file_download(mirror, f"actions-runner-linux-x64-{RUNNER_VERSION}.tar.gz", local_dir=str(RUNNER_DIR / "dl"),
                                      token=os.environ.get("MODELSCOPE_API_TOKEN") or None)
            shutil.move(got, tgz)
        else:
            import socket
            import urllib.request
            socket.setdefaulttimeout(120)
            urllib.request.urlretrieve(url, tgz)
        with tarfile.open(tgz, "r:gz") as tf:
            tf.extractall(RUNNER_DIR)
        tgz.unlink()
    except Exception as exc:  # noqa: BLE001
        _set(runner=f"download failed ({'mirror ' + mirror if mirror else url}): {type(exc).__name__}: {str(exc)[:200]}")
        return False
    return True


def _copy_cfg(src: Path, dst: Path) -> bool:
    if not all((src / f).exists() for f in CFG_FILES):
        return False
    dst.mkdir(parents=True, exist_ok=True)
    for f in CFG_FILES:
        shutil.copyfile(src / f, dst / f)
    return True


def register_runner() -> bool:
    if (RUNNER_DIR / ".runner").exists() or _copy_cfg(RUNNER_CFG, RUNNER_DIR):
        return True
    tok = os.environ.get("GH_RUNNER_REG_TOKEN") or ""
    if not tok:
        _set(runner="NOT REGISTERED: no GH_RUNNER_REG_TOKEN (re-run deploy-studio-runner.yml with a fresh STUDIO_RUNNER_REG_TOKEN)")
        return False
    name = os.environ.get("GH_RUNNER_NAME") or "studio-runner"
    r = subprocess.run(["./config.sh", "--url", REPO_URL, "--token", tok, "--name", name, "--labels", "studio", "--unattended", "--replace", "--disableupdate", "--work", "_work"],
                       cwd=RUNNER_DIR, env=_runner_env(), capture_output=True, text=True)
    out = (r.stdout + r.stderr).replace(tok, "***")
    if r.returncode:
        _set(runner=f"registration failed (exit {r.returncode}): {out[-300:]}")
        return False
    _set(runner="registered" + ("" if _copy_cfg(RUNNER_DIR, RUNNER_CFG) else " (credentials NOT saved to the persistent disk: a restart will need a new token)"))
    return True


def runner_loop():
    while True:
        try:
            if install_runner() and register_runner():
                _set(runner="online (listening for jobs labeled studio)")
                log = open(RUNNER_DIR / "run.log", "ab")
                p = subprocess.Popen(["./run.sh"], cwd=RUNNER_DIR, env=_runner_env(), stdout=log, stderr=subprocess.STDOUT)
                code = p.wait()
                _set(runner=f"runner exited {code}, restarting", runner_restarts=STATE["runner_restarts"] + 1)
        except Exception as exc:  # noqa: BLE001
            _set(runner=f"error: {type(exc).__name__}: {str(exc)[:200]}")
        time.sleep(30)


def status() -> str:
    with _LOCK:
        s = dict(STATE)
    tail = ""
    try:
        tail = "\n".join((RUNNER_DIR / "run.log").read_text(errors="replace").splitlines()[-8:])
    except OSError:
        pass
    try:
        du = shutil.disk_usage(DISK)
        s["disk_free_gb"] = round(du.free / 2**30, 1)
    except OSError:
        pass
    return json.dumps(s, indent=1, ensure_ascii=False) + "\n\nrunner log:\n" + tail


def selftest() -> int:
    m = {"items": {"big": {"bytes": 9}, "small": {"bytes": 1}, "old": {"bytes": 5}}}
    assert [k for k, _ in plan_restore(m, {"old"})] == ["small", "big"]
    assert target_name("data__x") == "nas_data" and target_name("sham_trainer") == ""
    env = (os.environ.__setitem__("GH_RUNNER_REG_TOKEN", "x") or _runner_env())
    assert "GH_RUNNER_REG_TOKEN" not in env and env["RUNNER_ALLOW_RUNASROOT"] == "1"
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        a, b = Path(t) / "a", Path(t) / "b"
        a.mkdir()
        assert not _copy_cfg(a, b)
        for f in CFG_FILES:
            (a / f).write_text(f)
        assert _copy_cfg(a, b) and (b / ".credentials").read_text() == ".credentials"
    print("sham-runner self-test OK")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    DISK.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=lambda: (_set(restore="running"), restore_once()), daemon=True).start()
    threading.Thread(target=runner_loop, daemon=True).start()
    import gradio as gr
    with gr.Blocks(title="sham-runner") as demo:
        gr.Markdown("### sham-runner: GitHub self-hosted runner (label `studio`) + the notebook's restored data")
        box = gr.Textbox(value=status, label="status", lines=24)
        gr.Button("refresh").click(status, None, box, api_name="status")
    demo.queue().launch(server_name="0.0.0.0", server_port=7860)
