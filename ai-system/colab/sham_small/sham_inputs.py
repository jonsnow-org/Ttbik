"""
Sham — resume inputs without any manual "Add Input" setup on Kaggle.

Why (owner report, 2026-09-24): every track lost progress for the same
reason — the notebook's attached Input was missing, stale (Track A read
the old dataset while publishing to "-v2"), or gone after re-importing
the notebook from GitHub. Each track already publishes its own dataset
at the end of a run, so the fix is to make each run fetch that dataset
itself, via the Kaggle API, whenever it isn't attached:

    fetch_dataset("sham-cpu-track-checkpoint-v2")

  * attached under /kaggle/input  -> used as-is (no download);
  * otherwise                     -> latest version downloaded into
    FETCH_ROOT (outside /kaggle/working, so it never inflates the
    session's own Output);
  * doesn't exist yet (true first run) or no credentials -> None.

Everything that searched only /kaggle/input (tokenizer_select,
sham_data_sources.Ledger, data_acquisition.text_stream_position, the
notebooks' own resume cells) now searches input_roots(), i.e. both.

resume_text_lineage() picks the text checkpoint to continue from — the
highest step in the track's own dataset, else (one-time fork) the
highest step among the given fork datasets — always together with the
tokenizer saved in the SAME dataset, never an unrelated one found
elsewhere (a mismatched tokenizer silently corrupts every weight).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

KAGGLE_INPUT = Path("/kaggle/input")
FETCH_ROOT = Path("/tmp/sham_inputs")

_TEXT_CKPT = re.compile(r"^(?:step_(\d+)|final)\.pt$")


def input_roots() -> list[Path]:
    return [p for p in (KAGGLE_INPUT, FETCH_ROOT) if p.exists()]


def rglob_inputs(pattern: str) -> list[Path]:
    found: list[Path] = []
    for root in input_roots():
        found.extend(root.rglob(pattern))
    return found


def _attached_dir(name: str) -> Path | None:
    if not KAGGLE_INPUT.exists():
        return None
    # /kaggle/input/<name> (classic mount) or nested owner/type folders.
    for pattern in (name, f"*/{name}", f"*/*/{name}", f"*/*/*/{name}"):
        for p in KAGGLE_INPUT.glob(pattern):
            if p.is_dir():
                return p
    return None


def _ensure_credentials() -> str | None:
    if os.environ.get("KAGGLE_USERNAME") and os.environ.get("KAGGLE_KEY"):
        return os.environ["KAGGLE_USERNAME"]
    try:
        from kaggle_secrets import UserSecretsClient

        secrets = UserSecretsClient()
        os.environ["KAGGLE_USERNAME"] = secrets.get_secret("KAGGLE_USERNAME")
        os.environ["KAGGLE_KEY"] = secrets.get_secret("KAGGLE_KEY")
        return os.environ["KAGGLE_USERNAME"]
    except Exception as exc:
        print(f"  ⚠ لا توجد بيانات دخول Kaggle (KAGGLE_USERNAME/KAGGLE_KEY): {exc}")
        return None


def _unzip_nested(root: Path) -> None:
    # "-r zip" uploads subfolders (checkpoints/) as archives; a mounted Input
    # shows them extracted, a CLI download may not — make both look the same.
    for _ in range(3):
        archives = list(root.rglob("*.zip"))
        if not archives:
            return
        for z in archives:
            target = z.parent / z.stem
            with zipfile.ZipFile(z) as zf:
                zf.extractall(target)
            z.unlink()


def fetch_dataset(name: str, owner: str | None = None) -> Path | None:
    """Folder holding the latest version of the account's dataset `name`,
    or None when it doesn't exist yet / can't be reached."""
    attached = _attached_dir(name)
    if attached:
        print(f"  • {name}: مرفقة كمُدخل ({attached})")
        return attached
    dest = FETCH_ROOT / name
    if dest.exists() and any(dest.iterdir()):
        return dest
    user = _ensure_credentials()
    if not user:
        return None
    if not shutil.which("kaggle"):
        subprocess.run(["pip", "install", "-q", "-U", "kaggle"], check=False)
    dest.mkdir(parents=True, exist_ok=True)
    ref = f"{owner or user}/{name}"
    r = subprocess.run(["kaggle", "datasets", "download", "-d", ref, "-p", str(dest), "--unzip"],
                       capture_output=True, text=True)
    _unzip_nested(dest)
    if r.returncode != 0 or not any(dest.iterdir()):
        shutil.rmtree(dest, ignore_errors=True)
        msg = ((r.stderr or "") + (r.stdout or "")).strip().splitlines()
        print(f"  • {name}: غير متاحة ({msg[-1][:160] if msg else 'لا شيء'}) — طبيعي في أول تشغيل لهذا المسار")
        return None
    size_mb = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file()) / 1e6
    print(f"  • {name}: نُزّلت آخر نسخة تلقائياً ({size_mb:,.0f} MB) إلى {dest}")
    return dest


def _checkpoint_step(path: Path) -> tuple[int, bool]:
    """(step, has_optimizer_state) — read without materializing the weights."""
    import torch

    payload = torch.load(path, map_location="cpu", weights_only=False, mmap=True)
    return int(payload.get("step") or 0), "optimizer_state_dict" in payload


def text_checkpoints(root: Path | None) -> list[tuple[int, bool, Path]]:
    if not root:
        return []
    out = []
    for p in root.rglob("*.pt"):
        if not _TEXT_CKPT.match(p.name):
            continue
        try:
            step, has_opt = _checkpoint_step(p)
        except Exception as exc:
            print(f"  ✖ {p}: تعذّرت قراءته ({exc.__class__.__name__})")
            continue
        out.append((step, has_opt, p))
    return sorted(out, key=lambda t: (t[0], t[1]))


def _tokenizer_in(root: Path, pattern: str) -> Path | None:
    found = sorted(root.rglob(pattern))
    return found[0] if found else None


def _dataset_dirs() -> list[Path]:
    """Every top-level attached/downloaded dataset folder under /kaggle/input
    and /tmp/sham_inputs, WHATEVER it happens to be named on Kaggle. Mirrors
    exactly what every Sham notebook did before automatic fetching existed
    (a plain Path("/kaggle/input").rglob("step_*.pt")) -- a manually-attached
    Input is found and used regardless of its title, not only when its name
    happens to match a known slug like "sham-checkpoint"."""
    # Depth 1 only: every real Kaggle dataset mounts as exactly /kaggle/input/<dataset>
    # (and fetch_dataset() downloads to exactly FETCH_ROOT/<name>) -- one level deeper would
    # start picking up a dataset's OWN internal subfolders (e.g. its checkpoints/ folder) as
    # if they were separate datasets.
    return [p for root in input_roots() for p in root.glob("*") if p.is_dir()]


def resume_text_lineage(own: str, forks: list[str] | tuple[str, ...] = (),
                        tokenizer_pattern: str = "*tokenizer*.json",
                        min_vocab: int = 0) -> dict | None:
    """{"checkpoint", "step", "has_optimizer", "tokenizer", "dataset", "forked"} or None.

    Two-stage search:
      1) ANY dataset already attached (Add Input) or already auto-downloaded
         this run, whatever it's named -- the same "just find it" behavior
         every Sham notebook always had. Highest step wins.
      2) Only if nothing at all is attached: auto-download `own` via the
         Kaggle API, then each of `forks` in order, and use the first that
         has both a real checkpoint AND its own tokenizer."""
    from text_tokenizer import ShamTextTokenizer

    def pair_in(root: Path | None, label: str) -> dict | None:
        if root is None:
            return None
        ckpts = text_checkpoints(root)
        if not ckpts:
            return None
        tok = _tokenizer_in(root, tokenizer_pattern)
        if tok is None:
            print(f"  ✖ {label}: فيها نقطة حفظ بلا أداة تقسيم النص الخاصة بها — تُتجاهل")
            return None
        vocab = ShamTextTokenizer.load(tok).vocab_size
        if vocab < min_vocab:
            print(f"  ✖ {label}: أداة تقسيم النص فيها صغيرة (vocab={vocab:,} < {min_vocab:,}) — لا يُستأنف منها")
            return None
        step, has_opt, path = ckpts[-1]
        return {"checkpoint": path, "step": step, "has_optimizer": has_opt, "tokenizer": tok, "dataset": label}

    print(f"البحث عن نقطة الاستئناف ({own}):")
    attached = [x for x in (pair_in(d, d.name) for d in _dataset_dirs()) if x]
    if attached:
        picked = max(attached, key=lambda x: x["step"])
        picked["forked"] = picked["dataset"] not in (own, *forks)
    else:
        picked = pair_in(fetch_dataset(own), own)
        if picked:
            picked["forked"] = False
        else:
            options = [x for x in (pair_in(fetch_dataset(f), f) for f in forks) if x]
            picked = max(options, key=lambda x: x["step"]) if options else None
            if picked:
                picked["forked"] = True
    if picked:
        how = "تفرّع لمرة واحدة من" if picked["forked"] else "استئناف من"
        print(f"✅ {how} {picked['dataset']}: {picked['checkpoint'].name} (الخطوة {picked['step']:,}) "
              f"+ {picked['tokenizer'].name}")
    else:
        print("لا توجد نقطة حفظ سابقة — يبدأ من الصفر (متوقَّع فقط في أول تشغيل حقيقي).")
    return picked


def publish_dataset(upload_dir: str | Path, name: str, message: str) -> str | None:
    """Create-or-version the account's dataset `name` from upload_dir
    (subfolders zipped, same "-r zip" rule as every track). Returns the
    slug on success, None on failure (the files stay in this session's
    Output either way)."""
    import json

    user = _ensure_credentials()
    if not user:
        return None
    if not shutil.which("kaggle"):
        subprocess.run(["pip", "install", "-q", "-U", "kaggle"], check=False)
    slug = f"{user}/{name}"
    upload_dir = Path(upload_dir)
    (upload_dir / "dataset-metadata.json").write_text(
        json.dumps({"title": name, "id": slug, "licenses": [{"name": "unknown"}]}))
    listed = subprocess.run(["kaggle", "datasets", "list", "-m", "--csv"], capture_output=True, text=True)
    exists = slug in (listed.stdout or "")
    cmd = (["kaggle", "datasets", "version", "-p", str(upload_dir), "-m", message, "-r", "zip"] if exists
           else ["kaggle", "datasets", "create", "-p", str(upload_dir), "-r", "zip"])
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode == 0 and "error" not in out.lower():
        print(f"{'نُشرت نسخة جديدة إلى' if exists else 'أُنشئت'} {slug} — التشغيل القادم يلتقطها تلقائياً.")
        return slug
    print(f"تنبيه: فشل النشر إلى {slug} — الملفات آمنة في Output هذه الجلسة.\n{out}")
    return None


if __name__ == "__main__":
    import tempfile

    import glob

    import torch

    from checkpoint import save_checkpoint
    from model import ShamSmall, ShamSmallConfig
    from text_tokenizer import train_text_tokenizer

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        KAGGLE_INPUT = td / "input"
        FETCH_ROOT = td / "fetched"
        os.environ.pop("KAGGLE_USERNAME", None)
        os.environ.pop("KAGGLE_KEY", None)

        cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=16)
        seed = td / "seed.txt"
        seed.write_text("شام نموذج عربي يتعلم من النصوص الحقيقية. " * 50, encoding="utf-8")
        small_tok = train_text_tokenizer([str(seed)], vocab_size=300)
        # A real, much larger and more varied corpus (this repo's own text files) so this
        # tokenizer's ACHIEVED vocab is genuinely bigger than small_tok's, not just requested
        # bigger -- BPE only merges as far as the corpus's real diversity allows.
        repo_root = Path(__file__).resolve().parents[3]
        big_corpus = [p for p in glob.glob(str(repo_root / "**/*.md"), recursive=True) if Path(p).stat().st_size > 0][:60]
        big_tok = train_text_tokenizer(big_corpus, vocab_size=1200)
        assert big_tok.vocab_size > small_tok.vocab_size * 2, (small_tok.vocab_size, big_tok.vocab_size)

        def make(ds: str, steps: list[int], with_final: int | None = None, tok=small_tok, tok_name="t_tokenizer.json"):
            d = KAGGLE_INPUT / ds / "checkpoints"
            d.mkdir(parents=True)
            m = ShamSmall(cfg)
            opt = torch.optim.AdamW(m.parameters())
            for s in steps:
                save_checkpoint(d / f"step_{s}.pt", m, s, optimizer=opt)
            if with_final is not None:
                save_checkpoint(d / "final.pt", m, with_final)
            tok.save(KAGGLE_INPUT / ds / tok_name)

        # Nothing attached anywhere yet -> no credentials in this sandbox, so no lineage (never crashes).
        assert resume_text_lineage("own-v2", forks=["fork-src"]) is None

        # ANY attached dataset is found and used, WHATEVER it's named on Kaggle -- exactly what
        # every Sham notebook did before automatic fetching existed (owner report, 2026-09-24: a
        # notebook manually resumed for months from an Input the code never knew the name of).
        make("some-title-the-owner-picked", [900])
        got = resume_text_lineage("own-v2", forks=["fork-src"])
        assert got["dataset"] == "some-title-the-owner-picked" and got["step"] == 900 and got["forked"]

        # Among several attached, the highest step wins regardless of which one matches own/forks.
        make("fork-src", [300], with_final=350)
        got = resume_text_lineage("own-v2", forks=["fork-src"])
        assert got["dataset"] == "some-title-the-owner-picked" and got["step"] == 900, got
        assert got["tokenizer"].parent.name == "some-title-the-owner-picked"  # paired from the SAME directory

        # own dataset attached with a higher step wins -- forked=False because its name matches `own`.
        make("own-v2", [950])
        got = resume_text_lineage("own-v2", forks=["fork-src"])
        assert not got["forked"] and got["dataset"] == "own-v2" and got["step"] == 950, got

        # tokenizer too small in every attached dataset -> all rejected, even the highest step; a
        # lower-step dataset whose tokenizer actually meets min_vocab is picked instead.
        make("full-vocab-but-behind", [50], tok=big_tok)
        threshold = (small_tok.vocab_size + big_tok.vocab_size) // 2
        got = resume_text_lineage("own-v2", forks=["fork-src"], min_vocab=threshold)
        assert got is not None and got["dataset"] == "full-vocab-but-behind" and got["step"] == 50, got
        # nested zip extraction (CLI download shape)
        z = FETCH_ROOT / "zipped"
        (z / "src").mkdir(parents=True)
        (z / "src" / "a.txt").write_text("x")
        shutil.make_archive(str(z / "checkpoints"), "zip", z / "src")
        shutil.rmtree(z / "src")
        _unzip_nested(z)
        assert (z / "checkpoints" / "a.txt").exists() and not list(z.rglob("*.zip"))
        assert fetch_dataset("missing-without-credentials") is None
        assert {p.name for p in rglob_inputs("*.txt")} == {"a.txt"}
    print("sham_inputs self-test: OK")
