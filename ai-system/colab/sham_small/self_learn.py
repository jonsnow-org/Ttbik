"""Loader for self_learn.py — assembles _self_learn_part_*.txt. Prefer force-push of d9c8978a."""
from pathlib import Path as _Path
_parts = sorted(_Path(__file__).resolve().parent.glob("_self_learn_part_*.txt"))
if not _parts:
    raise ImportError("missing _self_learn_part_*.txt next to self_learn.py")
exec("".join(p.read_text(encoding="utf-8") for p in _parts), globals())
