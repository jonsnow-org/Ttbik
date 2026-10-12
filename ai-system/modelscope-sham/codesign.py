"""
Signature of the code the Studio pulls from the model repo (studio_code/). The Studio runs that code, so it must run ONLY code that
the GitHub bridge signed: HMAC-SHA256 over every file's relative path and bytes, with a key that is not in the repo.

Key: SHAM_CODE_SIGNING_KEY when set (a separate secret: GitHub secret + Studio secret, same value — the strong setting);
otherwise derived from the ModelScope account token both sides already hold (MODELSCOPE_TOKEN on GitHub, MODELSCOPE_API_TOKEN in the Studio).
Anyone who can only WRITE to the model repo, without the key, cannot make code the Studio accepts.

    sign(dir, env)   -> hex signature      verify(dir, signature, env) -> bool (constant-time; extra, missing or changed files all fail)
"""
from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path

SIG_NAME = "CODE_SIG"


def _key(env) -> bytes:
    secret = env.get("SHAM_CODE_SIGNING_KEY") or env.get("MODELSCOPE_API_TOKEN") or env.get("MODELSCOPE_TOKEN") or ""
    if not secret:
        raise RuntimeError("لا مفتاح توقيع (SHAM_CODE_SIGNING_KEY أو مفتاح ModelScope) — لا توقيع ولا تحقق")
    return hashlib.sha256(b"sham-code-v1|" + secret.encode("utf-8")).digest()


def files(root: Path) -> list[Path]:
    return sorted(p for p in Path(root).rglob("*") if p.is_file() and p.name != SIG_NAME)


def digest(root: Path) -> str:
    h = hashlib.sha256()
    root = Path(root)
    for f in files(root):
        rel = f.relative_to(root).as_posix()
        h.update(len(rel).to_bytes(4, "big") + rel.encode("utf-8"))
        data = f.read_bytes()
        h.update(len(data).to_bytes(8, "big") + data)
    return h.hexdigest()


def sign(root: Path, env=os.environ) -> str:
    return hmac.new(_key(env), digest(root).encode(), hashlib.sha256).hexdigest()


def verify(root: Path, signature: str, env=os.environ) -> bool:
    try:
        if any(p.is_symlink() for p in Path(root).rglob("*")):
            return False
        return hmac.compare_digest(sign(root, env), (signature or "").strip())
    except Exception:
        return False


if __name__ == "__main__":
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        (d / "a.py").write_text("x = 1\n", encoding="utf-8")
        (d / "sub").mkdir()
        (d / "sub" / "b.py").write_text("y = 2\n", encoding="utf-8")
        env = {"MODELSCOPE_TOKEN": "tok-one"}
        sig = sign(d, env)
        assert verify(d, sig, {"MODELSCOPE_API_TOKEN": "tok-one"})            # the Studio's name for the same token verifies
        assert not verify(d, sig, {"MODELSCOPE_API_TOKEN": "tok-two"})        # another key: rejected
        assert not verify(d, "0" * 64, env) and not verify(d, "", env)
        (d / "a.py").write_text("x = 2\n", encoding="utf-8")
        assert not verify(d, sig, env)                                        # a changed file: rejected
        (d / "a.py").write_text("x = 1\n", encoding="utf-8")
        assert verify(d, sig, env)
        (d / "extra.py").write_text("import os\n", encoding="utf-8")
        assert not verify(d, sig, env)                                        # an added file: rejected
        (d / "extra.py").unlink()
        (d / "sub" / "b.py").unlink()
        assert not verify(d, sig, env)                                        # a removed file: rejected
        (d / "sub" / "b.py").write_text("y = 2\n", encoding="utf-8")
        (d / "link.py").symlink_to(d / "a.py")
        assert not verify(d, sign(d, env), env)                               # symlinks are never accepted
        assert not verify(d, sig, {})                                         # no key at all: rejected, no crash
        env2 = {"SHAM_CODE_SIGNING_KEY": "strong", "MODELSCOPE_TOKEN": "tok-one"}
        (d / "link.py").unlink()
        assert verify(d, sign(d, env2), {"SHAM_CODE_SIGNING_KEY": "strong", "MODELSCOPE_API_TOKEN": "other"})   # the separate key wins
    print("codesign self-test OK")
