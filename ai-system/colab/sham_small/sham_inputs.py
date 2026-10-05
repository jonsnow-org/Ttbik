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

# Earlier names of the same datasets (renames), treated as the notebook's own lineage.
OLD_NAMES = {
    "sham-checkpoint": ("nova-small-checkpoint",),
    "sham-cpu-track-checkpoint-v2": ("sham-cpu-track-checkpoint",),
    "sham-research-track-checkpoint-v2": ("sham-research-track-checkpoint",),
}

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
    if os.environ.get("KAGGLE_USERNAME") and (os.environ.get("KAGGLE_KEY") or os.environ.get("KAGGLE_API_TOKEN")):
        return os.environ["KAGGLE_USERNAME"]   # GitHub Actions: the repository's KAGGLE_API_TOKEN + the account name
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


# Each stage's own checkpoint file. If the LATEST version of that dataset does not
# contain it, another notebook published over the dataset (a real incident: a
# separate crawl notebook versioned sham-multimodal-checkpoint with its own
# final.pt, dropping final_multimodal.pt and the ledgers) — fetch_dataset then
# walks back to the newest version that still has it, instead of silently
# restarting the stage from an earlier lineage.
REQUIRED_FILE = {
    "sham-multimodal-checkpoint": "final_multimodal.pt",
    "sham-chat-checkpoint": "final_chat.pt",
}
WALK_BACK_VERSIONS = 15
# Where a foreign publication found on top of one of our datasets is moved to
# when the dataset is repaired (see _repair). sham-crawl-legacy holds what the
# engineer's first crawl notebook published there — its own name, so the live
# trainer (sham-crawl-checkpoint) never overwrites it; the chat stage merges it
# through the repair stage and the guard like every sham-crawl-* dataset.
FOREIGN_HOME = {
    "sham-multimodal-checkpoint": "sham-crawl-legacy",
    "sham-chat-checkpoint": "sham-chat-checkpoint-incoming",
}


def _split_name(name: str) -> tuple[str, str | None]:
    """"dataset#file" -> ("dataset", "file"): fetch the newest version of
    `dataset` that contains `file` (used to read a foreign checkpoint that was
    published into one of our datasets). Plain names use REQUIRED_FILE."""
    if "#" in name:
        base, need = name.split("#", 1)
        return base, need
    return name, REQUIRED_FILE.get(name)


def _has(root: Path, pattern: str | None) -> bool:
    return pattern is None or any(root.rglob(pattern))


def _rest_auth() -> dict:
    """requests kwargs authenticating to Kaggle's REST API: the classic username+key, or the new-style API token."""
    tok = os.environ.get("KAGGLE_API_TOKEN")
    if tok and not os.environ.get("KAGGLE_KEY"):
        return {"headers": {"Authorization": f"Bearer {tok}"}}
    return {"auth": (os.environ.get("KAGGLE_USERNAME"), os.environ.get("KAGGLE_KEY"))}


def _download_version(ref: str, version: int, dest: Path) -> bool:
    """One specific dataset version through Kaggle's public REST API."""
    import requests

    url = f"https://www.kaggle.com/api/v1/datasets/download/{ref}?datasetVersionNumber={version}"
    try:
        with requests.get(url, stream=True, timeout=600, **_rest_auth()) as r:
            if r.status_code != 200:
                return False
            dest.mkdir(parents=True, exist_ok=True)
            archive = dest / "_v.zip"
            with open(archive, "wb") as fh:
                for chunk in r.iter_content(1 << 20):
                    fh.write(chunk)
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(dest)
        archive.unlink()
        _unzip_nested(dest)
        return True
    except Exception as exc:
        print(f"  ⚠ تعذّر تنزيل النسخة {version} من {ref}: {exc}")
        return False


def _current_version(ref: str) -> int | None:
    import requests

    try:
        r = requests.get(f"https://www.kaggle.com/api/v1/datasets/view/{ref}", timeout=60, **_rest_auth())
        data = r.json() if r.status_code == 200 else {}
        v = data.get("currentVersionNumber") or max((x.get("versionNumber", 0) for x in data.get("versions") or []), default=0)
        return int(v) or None
    except Exception:
        return None


def _walk_back(ref: str, need: str, dest_root: Path) -> Path | None:
    latest = _current_version(ref)
    if not latest:
        print(f"  ⚠ تعذّر معرفة رقم آخر نسخة من {ref} — لا يمكن البحث في النسخ السابقة.")
        return None
    for v in range(latest - 1, max(latest - 1 - WALK_BACK_VERSIONS, 0), -1):
        d = dest_root.with_name(f"{dest_root.name}__v{v}")
        if not (d.exists() and _has(d, need)):
            shutil.rmtree(d, ignore_errors=True)
            if not _download_version(ref, v, d):
                continue
        if _has(d, need):
            print(f"  ↩ {ref}: آخر نسخة فيها {need} هي النسخة {v} (من {latest}) — استُخدمت هي.")
            return d
    print(f"  ⚠ {ref}: لا توجد نسخة فيها {need} ضمن آخر {WALK_BACK_VERSIONS} نسخة.")
    return None


def _repair(base: str, foreign: Path, good: Path) -> bool:
    """The damaged latest version is repaired, not skipped: its files (a
    complete, self-consistent set from another notebook) are published to
    their own dataset FOREIGN_HOME[base], and only once that succeeded a new
    version of `base` is published that restores this stage's files from
    `good`. Both results stay on Kaggle, each in its own place; if either
    publish fails nothing is changed and the next run tries again."""
    home = FOREIGN_HOME.get(base, f"{base}-incoming")
    stage = FETCH_ROOT / f"_repair_{base}"
    shutil.rmtree(stage, ignore_errors=True)
    shutil.copytree(foreign, stage / "foreign")
    shutil.copytree(good, stage / "restored")
    print(f"  🔧 إصلاح {base}: نقل ما نشره الدفتر الآخر إلى {home}، ثم إعادة ملفات هذه المرحلة كآخر نسخة.")
    ok = bool(publish_dataset(stage / "foreign", home, f"moved here from {base} (published there by another notebook)"))
    if ok:
        ok = bool(publish_dataset(stage / "restored", base, f"repair: restored this stage's files; the other notebook's files moved to {home}"))
    print(f"  {'✅ تم الإصلاح' if ok else '⚠ لم يكتمل الإصلاح — لم يتغير شيء، ويُعاد المحاولة في التشغيل القادم'}: {base}")
    shutil.rmtree(stage, ignore_errors=True)
    return ok


def fetch_dataset(name: str, owner: str | None = None, fresh: bool = False) -> Path | None:
    """Folder holding the latest version of the account's dataset `name`,
    or None when it doesn't exist yet / can't be reached.

    fresh=True ignores an attached Input and any earlier download and pulls
    the version that is latest RIGHT NOW -- used just before publishing, so
    a notebook merges what another notebook published meanwhile instead of
    overwriting it.

    If the stage's own checkpoint file (REQUIRED_FILE, or "dataset#file") is
    missing from the latest version, the newest version that has it is used."""
    base, need = _split_name(name)
    if not fresh:
        attached = _attached_dir(base)
        if attached and _has(attached, need):
            print(f"  • {base}: مرفقة كمُدخل ({attached})")
            return attached
    safe = name.replace("#", "__").replace("/", "_")
    dest = FETCH_ROOT / (f"{safe}__fresh" if fresh else safe)
    if fresh:
        shutil.rmtree(dest, ignore_errors=True)
    elif dest.exists() and any(dest.iterdir()):
        if _has(dest, need):
            return dest
        older = sorted((d for d in dest.parent.glob(f"{dest.name}__v*") if _has(d, need)),
                       key=lambda d: int(d.name.rsplit("__v", 1)[1]))
        return older[-1] if older else (None if name != base else dest)
    user = _ensure_credentials()
    if not user:
        return None
    if not shutil.which("kaggle"):
        subprocess.run(["pip", "install", "-q", "-U", "kaggle"], check=False)
    dest.mkdir(parents=True, exist_ok=True)
    ref = f"{owner or user}/{base}"
    r = subprocess.run(["kaggle", "datasets", "download", "-d", ref, "-p", str(dest), "--unzip"],
                       capture_output=True, text=True)
    _unzip_nested(dest)
    if r.returncode != 0 or not any(dest.iterdir()):
        shutil.rmtree(dest, ignore_errors=True)
        msg = ((r.stderr or "") + (r.stdout or "")).strip().splitlines()
        print(f"  • {base}: غير متاحة ({msg[-1][:160] if msg else 'لا شيء'}) — طبيعي في أول تشغيل لهذا المسار")
        return None
    size_mb = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file()) / 1e6
    print(f"  • {base}: نُزّلت آخر نسخة تلقائياً ({size_mb:,.0f} MB) إلى {dest}")
    if not _has(dest, need):
        print(f"  ⚠ آخر نسخة من {base} لا تحتوي {need} — نشر فوقها دفتر آخر. البحث في النسخ السابقة…")
        older = _walk_back(ref, need, dest)
        if older is not None:
            _repair(base, dest, older)
            return older
        return None if name != base else dest
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
    # A notebook continues its OWN lineage (its dataset, or that dataset's old name)
    # whenever that is attached. Another lineage's checkpoint is only a starting
    # point when there is nothing of its own -- otherwise e.g. Track A would jump
    # to the GPU track's checkpoint as soon as that one has more steps, dropping
    # Track A's own training (bug found 2026-09-27).
    own_names = [own, *OLD_NAMES.get(own, ())]
    mine = [x for x in attached if x["dataset"] in own_names]
    if not mine:
        # Own lineage not attached: download it (latest version) before considering
        # anything else, so a notebook never forks again once it has its own dataset.
        for name in own_names:
            x = pair_in(fetch_dataset(name), name)
            if x:
                mine = [x]
                break
    if mine:
        picked = max(mine, key=lambda x: x["step"])
        picked["forked"] = False
    else:
        # First run ever: start from the most-trained other lineage (attached, else the forks).
        others = [x for x in attached if x["dataset"] not in own_names]
        if not others:
            others = [x for x in (pair_in(fetch_dataset(f), f) for f in forks) if x]
        picked = max(others, key=lambda x: x["step"]) if others else None
        if picked:
            picked["forked"] = True
    if picked:
        how = "تفرّع لمرة واحدة من" if picked["forked"] else "استئناف من"
        print(f"✅ {how} {picked['dataset']}: {picked['checkpoint'].name} (الخطوة {picked['step']:,}) "
              f"+ {picked['tokenizer'].name}")
    else:
        print("لا توجد نقطة حفظ سابقة — يبدأ من الصفر (متوقَّع فقط في أول تشغيل حقيقي).")
    return picked


CRAWL_PREFIX = "sham-crawl-"


def crawl_dataset_names(prefix: str = CRAWL_PREFIX) -> dict:
    """Automatic discovery of every collection notebook's output: the
    account's datasets whose name starts with `prefix`, split into models
    and text corpora ({"models": [...], "corpora": [...]}). A new collection
    notebook only has to publish under a name with this prefix — nothing
    else needs to know its name."""
    user = _ensure_credentials()
    found = {"models": [], "corpora": []}
    if not user:
        return found
    if not shutil.which("kaggle"):
        subprocess.run(["pip", "install", "-q", "-U", "kaggle"], check=False)
    names = []
    for page in range(1, 6):
        r = subprocess.run(["kaggle", "datasets", "list", "-m", "-s", prefix, "--csv", "-p", str(page)],
                           capture_output=True, text=True)
        rows = [l.split(",", 1)[0] for l in (r.stdout or "").splitlines()[1:] if "/" in l.split(",", 1)[0]]
        if not rows:
            break
        names += [ref.split("/", 1)[1] for ref in rows if ref.split("/", 1)[0] == user]
    for n in sorted(set(names)):
        if not n.startswith(prefix):
            continue
        (found["corpora"] if n.endswith("corpus") else found["models"]).append(n)
    return found


def account_dataset_names() -> list[str]:
    """Every dataset of the account (names only), via the Kaggle API; [] if unreachable."""
    user = _ensure_credentials()
    if not user:
        return []
    if not shutil.which("kaggle"):
        subprocess.run(["pip", "install", "-q", "-U", "kaggle"], check=False)
    names: list[str] = []
    for page in range(1, 11):
        r = subprocess.run(["kaggle", "datasets", "list", "-m", "--csv", "-p", str(page)],
                           capture_output=True, text=True)
        rows = [l.split(",", 1)[0] for l in (r.stdout or "").splitlines()[1:] if "/" in l.split(",", 1)[0]]
        if not rows:
            break
        names += [ref.split("/", 1)[1] for ref in rows if ref.split("/", 1)[0] == user]
    return sorted(set(names))


def model_dataset_candidates(names: list[str] | None = None) -> list[str]:
    """Account datasets that may hold a Sham model to merge: every dataset starting with "sham"
    (or the old "nova-small") that is not a tokenizer-only or text-corpus dataset — the name need
    not say "checkpoint". Whether one really holds a model is decided by looking inside it (the
    repair stage + the gate), so a wrong guess costs one log line, never a bad merge."""
    names = account_dataset_names() if names is None else names
    return [n for n in names if n.startswith(("sham", "nova-small")) and not any(x in n for x in ("tokenizer", "corpus", "reports"))]


def repo_dataset_names() -> set[str]:
    """Dataset names the repository's notebooks/modules mention (what the project knowingly uses)."""
    import re
    root = Path(__file__).parent
    used: set[str] = set()
    for f in [*root.glob("*.py"), *(root / "kaggle_notebooks").glob("*.ipynb")]:
        try:
            used |= set(re.findall(r"\b(?:sham|nova)-[a-z0-9]+(?:-[a-z0-9]+)*\b", f.read_text(encoding="utf-8")))
        except Exception:
            pass
    return used


def dataset_inventory(names: list[str] | None = None) -> str:
    """Which of the account's datasets the project uses, and which nobody reads (lost/forgotten)."""
    names = account_dataset_names() if names is None else names
    if not names:
        return "📦 تعذّر قراءة قائمة مجموعات البيانات."
    used = repo_dataset_names()
    mine = [n for n in names if n.startswith(("sham", "nova"))]
    unused = [n for n in mine if n not in used and not n.startswith(CRAWL_PREFIX)]
    return (f"📦 مجموعات بيانات شام في حسابك: {len(mine)} | يقرؤها المشروع: {len(mine) - len(unused)}"
            + (f" | لا أحد يقرؤها: {', '.join(unused)}" if unused else ""))


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
    # `datasets list` returns ONE page (20 rows): with more datasets than that an existing one looked absent and "create" failed
    # ("title already in use") — so read every page, and below fall back to a new version if create says the title exists
    exists = False
    for page in range(1, 11):
        listed = subprocess.run(["kaggle", "datasets", "list", "-m", "--csv", "-p", str(page)], capture_output=True, text=True)
        rows = (listed.stdout or "").strip().splitlines()
        if slug in (listed.stdout or ""):
            exists = True
            break
        if len(rows) < 2:
            break
    version_cmd = ["kaggle", "datasets", "version", "-p", str(upload_dir), "-m", message, "-r", "zip"]
    create_cmd = ["kaggle", "datasets", "create", "-p", str(upload_dir), "-r", "zip"]
    r = subprocess.run(version_cmd if exists else create_cmd, capture_output=True, text=True)
    out = (r.stdout or "") + (r.stderr or "")
    if not exists and "already in use" in out.lower():
        exists = True
        r = subprocess.run(version_cmd, capture_output=True, text=True)
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

        # own dataset attached -> it wins EVEN WITH FEWER STEPS than another attached lineage
        make("own-v2", [120])
        got = resume_text_lineage("own-v2", forks=["fork-src"])
        assert not got["forked"] and got["dataset"] == "own-v2" and got["step"] == 120, got
        # an old name of the own dataset counts as own
        OLD_NAMES["own-v2"] = ("own-old",)
        make("own-old", [500])
        got = resume_text_lineage("own-v2", forks=["fork-src"])
        assert not got["forked"] and got["dataset"] == "own-old" and got["step"] == 500, got

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


# Every training notebook imports this module before it trains: install the
# per-session learning-rate schedule fix here so resumed runs stop training at
# a tenth of their intended rate (see sham_schedule.py) — no notebook cell
# changes, so no re-import needed.
try:
    import sham_schedule as _sham_schedule
    _sham_schedule.install()
except Exception as _exc:  # never block a run over this
    print(f"sham_schedule not installed: {_exc}")

# Same mechanism for the image/audio tokenizers: codebook revival instead of
# the vanilla VQ training that collapsed to ~10 of 8,192 codes (sham_vq.py).
try:
    import sham_vq as _sham_vq
    _sham_vq.install()
except Exception as _exc:
    print(f"sham_vq not installed: {_exc}")

# And the contrastive text<->media link loss inside train.train (sham_link_contrast.py):
# stage 2 and the chat stage pull each caption toward its own image/sound.
try:
    import sham_link_contrast as _sham_link_contrast
    _sham_link_contrast.install()
except Exception as _exc:
    print(f"sham_link_contrast not installed: {_exc}")

# The session-level pieces every plain-text training notebook gets without a cell change:
# the held-out yardstick that tells learning from memorising (sham_train_eval.py).
try:
    import sham_train_eval as _sham_train_eval
    _sham_train_eval.install()
except Exception as _exc:
    print(f"sham_train_eval not installed: {_exc}")

# Sham is a general model: its text is spelled with the general tokenizer (many languages, code, math)
# and older checkpoints are moved to it on load — no cell change (sham_general_text.py).
try:
    import sham_general_text as _sham_general_text
    _sham_general_text.install()
except Exception as _exc:
    print(f"sham_general_text not installed: {_exc}")

# Mixed precision on GPU sessions (sham_amp.py): fp16 + loss scaling on a T4, CPU untouched.
try:
    import sham_amp as _sham_amp
    _sham_amp.install()
except Exception as _exc:
    print(f"sham_amp not installed: {_exc}")

# Cell fixes reach already-imported notebooks without re-importing them (sham_cell_sync.py).
try:
    import sham_cell_sync as _sham_cell_sync
    _sham_cell_sync.install()
except Exception as _exc:
    print(f"sham_cell_sync not installed: {_exc}")
