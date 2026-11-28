"""Runs inside Kaggle (pushed by sham_publish_probe.py kernel-probe), with NO Kaggle secrets -- the exact start every
API-pushed training notebook gets. It answers one question with evidence: can a pushed kernel publish?

Prints, in order: whether Kaggle Secrets answer at all; whether sham-runtime-creds/kaggle.json is mounted; whether the
kaggle CLI authenticates with it; and whether the same publish command the notebooks run would work. No secret value is
ever printed -- only presence booleans and the command's own return code and message.
"""
import json
import os
import subprocess
from pathlib import Path

print("=== who am I ===")
print("inputs:", sorted(p.name for p in Path("/kaggle/input").glob("*")) if Path("/kaggle/input").exists() else "no /kaggle/input")

print("=== Kaggle Secrets (what the notebooks' own cells call) ===")
try:
    from kaggle_secrets import UserSecretsClient

    _c = UserSecretsClient()
    print("KAGGLE_USERNAME reachable:", bool(_c.get_secret("KAGGLE_USERNAME")))
    print("KAGGLE_KEY reachable:", bool(_c.get_secret("KAGGLE_KEY")))
    print("SECRETS: OK")
except Exception as exc:
    print(f"SECRETS: FAIL {type(exc).__name__}: {str(exc)[:300]}")

print("=== sham-runtime-creds fallback ===")
creds = None
for p in sorted(Path("/kaggle/input").rglob("kaggle.json")) if Path("/kaggle/input").exists() else []:
    try:
        d = json.loads(Path(p).read_text())
    except Exception:
        continue
    if d.get("username") and d.get("key"):
        creds = d
        print(f"kaggle.json found at {p} (username set: True, key length: {len(str(d['key']))}, token form: {str(d['key']).startswith('KGAT_')})")
        break
if not creds:
    print("kaggle.json: MISSING")
else:
    os.environ["KAGGLE_USERNAME"] = creds["username"]
    os.environ["KAGGLE_KEY"] = creds["key"]
    if str(creds["key"]).startswith("KGAT_"):
        os.environ["KAGGLE_API_TOKEN"] = creds["key"]
    subprocess.run(["pip", "install", "-q", "-U", "kaggle"], check=False)
    for label, cmd in (("list", ["kaggle", "datasets", "list", "-m", "--csv", "-p", "1"]),
                       ("version-dry", None)):
        if cmd is None:
            continue
        r = subprocess.run(cmd, capture_output=True, text=True)
        first = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()
        print(f"`kaggle datasets {label}` rc={r.returncode} :: {first[0][:200] if first else ''}")
    # the real write path, on a throwaway dataset of this probe only (never a training dataset)
    out = Path("/kaggle/working/probe_upload")
    out.mkdir(parents=True, exist_ok=True)
    (out / "probe.txt").write_text("publish probe from a secret-less pushed kernel")
    (out / "dataset-metadata.json").write_text(json.dumps({"title": "sham-publish-probe-kernel",
                                                          "id": f"{creds['username']}/sham-publish-probe-kernel",
                                                          "licenses": [{"name": "unknown"}]}))
    r = subprocess.run(["kaggle", "datasets", "create", "-p", str(out), "-r", "zip"], capture_output=True, text=True)
    print(f"`kaggle datasets create` rc={r.returncode} :: {((r.stdout or '') + (r.stderr or '')).strip()[:400]}")
print("=== done ===")
