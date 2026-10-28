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


def texts(js: str) -> frozenset[str]:
    """The user-visible Arabic / English string literals of a chunk: identical code gives identical texts whatever the build's module ids / hashes are."""
    return frozenset(re.findall(r"[\u0600-\u06FF][^\"'`\\]{6,}", js)) | frozenset(re.findall(r'"([A-Za-z][A-Za-z &/·-]{14,60})"', js))


def same_build(a: frozenset[str], b: frozenset[str]) -> bool:
    """The two builds show the same texts (a build id or hash differing between the Oracle and the Vercel build is normal)."""
    return bool(a) and bool(b) and len(a ^ b) <= max(2, int(0.002 * len(a | b)))


def fetch(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "freshness-check"}), timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def main() -> int:
    got = {}
    for name, base in ORIGINS.items():
        try:
            chunks = page_chunks(fetch(base + "/coder-app"))
            got[name] = frozenset().union(*(texts(fetch(base + c)) for c in chunks)) if chunks else frozenset()
        except Exception as e:  # noqa: BLE001
            got[name] = frozenset()
            print(f"{name}: unreachable ({type(e).__name__})")
        print(f"{name}: {len(got[name])} texts")
    ok = same_build(got["oracle"], got["vercel"])
    print(f"texts only on Oracle: {len(got['oracle'] - got['vercel'])}, only on Vercel: {len(got['vercel'] - got['oracle'])}")
    print("SAME BUILD" if ok else "DIFFERENT BUILDS: the primary (Oracle) is not serving what Vercel serves")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
