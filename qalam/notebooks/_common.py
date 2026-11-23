"""Helpers shared by the notebooks (data fetching, paths). Nothing secret; datasets come from public hosts with their licences recorded."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
ART = Path(os.environ.get("QALAM_ARTIFACTS", ROOT / "artifacts"))
ART.mkdir(parents=True, exist_ok=True)
SMOKE = os.environ.get("QALAM_SMOKE", "1") == "1"        # 1 = a few minutes on a laptop-class CPU; 0 = the real run on a trainer

from qalam.data import Record  # noqa: E402


def _get(url: str, tries: int = 6) -> dict:
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "qalam-notebook"}), timeout=60) as r:
                return json.load(r)
        except Exception as exc:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))                                   # 429 / transient: back off
    raise RuntimeError("unreachable")


def fetch_wikipedia(lang: str, articles: int, offset: int = 0, cache: Path | None = None) -> list[Record]:
    """Wikipedia articles (CC-BY-SA-4.0) through the Hugging Face datasets server, 100 per request, cached on disk."""
    cache = cache or ART / "raw"
    cache.mkdir(parents=True, exist_ok=True)
    out: list[Record] = []
    got = 0
    while got < articles:
        n = min(100, articles - got)
        f = cache / f"wiki_{lang}_{offset + got}_{n}.json"
        if f.exists():
            rows = json.loads(f.read_text(encoding="utf-8"))
        else:
            q = urllib.parse.urlencode({"dataset": "wikimedia/wikipedia", "config": f"20231101.{lang}", "split": "train", "offset": offset + got, "length": n})
            rows = [r["row"] for r in _get("https://datasets-server.huggingface.co/rows?" + q)["rows"]]
            f.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        for r in rows:
            out.append(Record(r["text"], r["url"], "external_reviewed", "CC-BY-SA-4.0", lang))
        got += n
        if not rows:
            break
    return out


def code_records(paths: list[Path], limit_bytes: int = 200_000) -> list[Record]:
    """Source files of OUR OWN repository (owner-curated, our licence)."""
    out: list[Record] = []
    for base in paths:
        for f in sorted(base.rglob("*")):
            if f.suffix in (".py", ".ts", ".md", ".yml", ".json") and f.is_file() and 200 < f.stat().st_size < limit_bytes and "node_modules" not in f.parts and "artifacts" not in f.parts:
                out.append(Record(f.read_text(encoding="utf-8", errors="replace"), str(f), "owner_curated", "owner", "code"))
    return out
