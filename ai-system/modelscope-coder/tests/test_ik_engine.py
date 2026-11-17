# Offline check of the optional ik_llama.cpp engine (run: python ai-system/modelscope-coder/tests/test_ik_engine.py):
# the parts are joined and verified by sha256, the engine is used only on a marked Studio and only while it works, saved-state side files travel with the state.
import hashlib, importlib.util, io, os, sys, tarfile, tempfile, time
from pathlib import Path
os.environ["CODER_MODEL_PATH"] = "/nonexistent"
spec = importlib.util.spec_from_file_location("app", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app.py"))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)

tmp = Path(tempfile.mkdtemp()); app.HERE = tmp
# a fake ik package: a flat folder with llama-server and a library, as the deploy builds it
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as t:
    for name, data in (("llama-server", b"#!/bin/sh\nexit 0\n"), ("libllama.so", b"x"), ("REF", b"a6383da")):
        ti = tarfile.TarInfo(name); ti.size = len(data); t.addfile(ti, io.BytesIO(data))
raw = buf.getvalue()
app._ENGINE.update(ik_bad=False, name="mainline")
assert not app._ik_wanted(), "no parts, no marker: mainline"
for i in range(0, len(raw), 64):
    (tmp / f"ik-llama.part{i // 64:03d}").write_bytes(raw[i:i + 64])
(tmp / "ik-llama.sha256").write_text(hashlib.sha256(raw).hexdigest() + "  ik-llama.tgz\n")
assert not app._ik_wanted(), "parts but no marker: still mainline"
(tmp / "engine.ik").write_text("on")
assert app._ik_wanted(), "marker + parts + sha: ik"
d = app._ik_dir()
assert (d / "llama-server").exists() and (d / "libllama.so").exists() and app._ENGINE["ik_ref"] == "a6383da", (list(d.iterdir()), app._ENGINE)
print("parts joined, verified and unpacked:", sorted(x.name for x in d.iterdir()))
# a wrong sha256 is refused
import shutil; shutil.rmtree(tmp / "_llama")
(tmp / "ik-llama.sha256").write_text("0" * 64)
try:
    app._ik_dir(); raise SystemExit("a wrong sha256 must be refused")
except RuntimeError as e:
    print("wrong sha256 refused:", e)
# it stops being wanted once it failed, and never on the picture-reading Studio
(tmp / "ik-llama.sha256").write_text(hashlib.sha256(raw).hexdigest())
assert app._ik_wanted()
app._ENGINE["ik_bad"] = True; assert not app._ik_wanted(); app._ENGINE["ik_bad"] = False
(tmp / "vision.on").write_text("on"); assert not app._ik_wanted(); (tmp / "vision.on").unlink()
assert app._ik_wanted()
# saved states: side files are pruned with their state and copied to the shared-start file
app.SLOT_DIR = tmp / "_slots_ik"; app.SLOT_DIR.mkdir()
def mk(name, age):
    for suffix in ("", ".checkpoints", ".tokens.json"):
        f = app.SLOT_DIR / (name + suffix); f.write_bytes(b"s"); os.utime(f, (time.time() - age, time.time() - age))
for i in range(5): mk(f"c{i}.bin", 100 - i)
app.SLOT_KEEP = 2; app._slot_prune()
left = sorted(x.name for x in app.SLOT_DIR.iterdir())
print("after prune:", left)
assert left == ["c3.bin", "c3.bin.checkpoints", "c3.bin.tokens.json", "c4.bin", "c4.bin.checkpoints", "c4.bin.tokens.json"], left
print("OK")
