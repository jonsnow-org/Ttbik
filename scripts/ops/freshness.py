"""Are the Oracle server (primary behind the gate) and Vercel (standby) serving the same build? Compares the content-hashed page chunks of /coder-app.

Prints one line per origin and exits 1 when they differ. No secrets: only public pages are fetched."""
from __future__ import annotations

import re
import sys
import urllib.request

ORIGINS = {"oracle": "https://89-168-89-15.sslip.io", "vercel": "https://ttbik.vercel.app"}


def page_chunks(html: str) -> list[str]:
    """The app's own page chunk file names (their hash is the content hash of the code)."""
    return sorted(set(re.findall(r"/_next/static/chunks/app/[^\"' ]*?page-[0-9a-f]+\.js", html)))


def same_build(a: list[str], b: list[str]) -> bool:
    return bool(a) and a == b


def fetch(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "freshness-check"}), timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def main() -> int:
    got = {}
    for name, base in ORIGINS.items():
        try:
            got[name] = page_chunks(fetch(base + "/coder-app"))
        except Exception as e:  # noqa: BLE001
            got[name] = []
            print(f"{name}: unreachable ({type(e).__name__})")
        print(f"{name}: {len(got[name])} page chunks {got[name][:3]}")
    ok = same_build(got["oracle"], got["vercel"])
    print("SAME BUILD" if ok else "DIFFERENT BUILDS: the primary (Oracle) is not serving what Vercel serves")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
