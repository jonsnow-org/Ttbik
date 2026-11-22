"""Signed node identities for the terminal mesh: ed25519 keys (RFC 8032).

A node's id IS its public key (32 bytes, base64url without padding), so nobody can speak for a node without its private key, and the relay
(Cloudflare Worker) is not trusted: every message body is signed end to end and re-verified by the receiver.
Uses `cryptography` when it is installed (fast); otherwise a small pure-Python RFC 8032 implementation (slow-ish, ~ms per op, stdlib only),
so the client works on any device with plain Python.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os

try:                                                            # fast path
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
    from cryptography.hazmat.primitives import serialization
    from cryptography.exceptions import InvalidSignature
    _HAVE_C = True
except Exception:                                               # pragma: no cover - exercised where cryptography is absent
    _HAVE_C = False


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    s = s or ""
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def canon(obj) -> bytes:
    """Canonical JSON (sorted keys, no spaces, UTF-8): the exact bytes that are signed. The Worker uses the same rule (sham-mesh-worker.js canon)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


# ------------------------------------------------------------------ pure-Python RFC 8032 (fallback)
_p = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_d = -121665 * pow(121666, _p - 2, _p) % _p
_I = pow(2, (_p - 1) // 4, _p)


def _xrec(y, sign):
    x2 = (y * y - 1) * pow(_d * y * y + 1, _p - 2, _p) % _p
    if x2 == 0:
        if sign:
            raise ValueError("bad point")
        return 0
    x = pow(x2, (_p + 3) // 8, _p)
    if (x * x - x2) % _p:
        x = x * _I % _p
    if (x * x - x2) % _p:
        raise ValueError("bad point")
    if x & 1 != sign:
        x = _p - x
    return x


_By = 4 * pow(5, _p - 2, _p) % _p
_B = (_xrec(_By, 0), _By, 1, _xrec(_By, 0) * _By % _p)


def _add(P, Q):
    A = (P[1] - P[0]) * (Q[1] - Q[0]) % _p
    B = (P[1] + P[0]) * (Q[1] + Q[0]) % _p
    C = 2 * P[3] * Q[3] * _d % _p
    D = 2 * P[2] * Q[2] % _p
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F % _p, G * H % _p, F * G % _p, E * H % _p)


def _mul(s, P):
    Q = (0, 1, 1, 0)
    while s:
        if s & 1:
            Q = _add(Q, P)
        P = _add(P, P)
        s >>= 1
    return Q


def _enc(P):
    zi = pow(P[2], _p - 2, _p)
    x, y = P[0] * zi % _p, P[1] * zi % _p
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _dec(b):
    y = int.from_bytes(b, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    if y >= _p:
        raise ValueError("bad point")
    x = _xrec(y, sign)
    return (x, y, 1, x * y % _p)


def _eq(P, Q):
    return (P[0] * Q[2] - Q[0] * P[2]) % _p == 0 and (P[1] * Q[2] - Q[1] * P[2]) % _p == 0


def _h(m):
    return int.from_bytes(hashlib.sha512(m).digest(), "little")


def _expand(seed):
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return a, h[32:]


def _py_pub(seed):
    return _enc(_mul(_expand(seed)[0], _B))


def _py_sign(seed, msg):
    a, prefix = _expand(seed)
    A = _enc(_mul(a, _B))
    r = _h(prefix + msg) % _L
    R = _enc(_mul(r, _B))
    k = _h(R + A + msg) % _L
    return R + int.to_bytes((r + k * a) % _L, 32, "little")


def _py_verify(pub, msg, sig):
    if len(pub) != 32 or len(sig) != 64:
        return False
    try:
        A, R = _dec(pub), _dec(sig[:32])
    except ValueError:
        return False
    s = int.from_bytes(sig[32:], "little")
    if s >= _L:
        return False
    k = _h(sig[:32] + pub + msg) % _L
    return _eq(_mul(s, _B), _add(R, _mul(k, A)))


# ------------------------------------------------------------------ public API
class Identity:
    """A node's key pair. `Identity.load_or_create(path)` keeps the private seed in a 0600 file (never logged, never sent)."""

    def __init__(self, seed: bytes):
        if len(seed) != 32:
            raise ValueError("seed must be 32 bytes")
        self._seed = seed
        if _HAVE_C:
            self._k = Ed25519PrivateKey.from_private_bytes(seed)
            self.pub = self._k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        else:
            self._k = None
            self.pub = _py_pub(seed)
        self.id = b64u(self.pub)

    @classmethod
    def generate(cls) -> "Identity":
        return cls(os.urandom(32))

    @classmethod
    def load_or_create(cls, path: str) -> "Identity":
        if path and os.path.isfile(path):
            return cls(unb64u(open(path).read().strip()))
        ident = cls.generate()
        if path:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(b64u(ident._seed))
        return ident

    def sign(self, msg: bytes) -> str:
        return b64u(self._k.sign(msg) if self._k is not None else _py_sign(self._seed, msg))

    def sign_obj(self, obj: dict) -> dict:
        """-> obj + {"by": <node id>, "sig": <signature over canon(obj without sig)>}."""
        body = dict(obj)
        body.pop("sig", None)
        body["by"] = self.id
        body["sig"] = self.sign(canon(body))
        return body

    def __repr__(self):                                          # never shows the seed
        return f"Identity({self.id[:10]}…)"


def verify(node_id: str, msg: bytes, sig: str) -> bool:
    try:
        pub, s = unb64u(node_id), unb64u(sig)
    except Exception:
        return False
    if len(pub) != 32 or len(s) != 64:
        return False
    if _HAVE_C:
        try:
            Ed25519PublicKey.from_public_bytes(pub).verify(s, msg)
            return True
        except (InvalidSignature, ValueError):
            return False
    return _py_verify(pub, msg, s)


def verify_obj(obj: dict, by: str | None = None) -> bool:
    """True if obj["sig"] is obj["by"]'s signature over the rest (and, when given, obj["by"] == by)."""
    if not isinstance(obj, dict) or "sig" not in obj or "by" not in obj:
        return False
    if by is not None and obj["by"] != by:
        return False
    body = {k: v for k, v in obj.items() if k != "sig"}
    return verify(obj["by"], canon(body), obj["sig"])


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
