"""Generate free Edge TTS narration for the existing promotional video renderer."""
from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

import edge_tts


async def generate(text: str, voice: str, output: Path) -> None:
    if not text.strip():
        raise ValueError("narration text is empty")
    output.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(text=text, voice=voice, rate="-4%")
    await communicate.save(str(output))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    asyncio.run(generate(args.text, args.voice, Path(args.out)))
    print(f"narration ready: {args.out}")


if __name__ == "__main__":
    main()
