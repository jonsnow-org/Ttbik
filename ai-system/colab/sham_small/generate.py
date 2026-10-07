"""Sham generate — loader (assembles _generate_part_*.txt). Replace with monolithic file when pushing d9c8978a."""
from pathlib import Path as _Path
_parts = sorted(_Path(__file__).resolve().parent.glob("_generate_part_*.txt"))
if not _parts:
    raise ImportError("missing _generate_part_*.txt next to generate.py")
exec("".join(p.read_text(encoding="utf-8") for p in _parts), globals())
