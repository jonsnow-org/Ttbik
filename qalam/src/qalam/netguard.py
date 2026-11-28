"""Outbound internet for the model's tools: FREE to reach any public address, and unable to reach anything private. A regular expression on the URL is not enough (a
public NAME can resolve to 10.0.0.5 or 169.254.169.254, a redirect can point inside, DNS can change between the check and the connection), so this module
(1) resolves the host and refuses unless EVERY address is globally routable, (2) connects to the address it checked (no second lookup: DNS rebinding cannot swap it),
(3) re-checks each redirect, and (4) caps the size of what it reads. Public internet is not restricted by any allow-list (owner decision 2026-11-23)."""
from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import urllib.parse
from typing import Callable

MAX_BYTES = 8 * 1024 * 1024
BLOCKED_NAMES = ("localhost", "metadata.google.internal", "metadata", "instance-data")
BLOCKED_SUFFIXES = (".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet")


class NetError(Exception):
    pass


def _ip_ok(addr: str) -> bool:
    ip = ipaddress.ip_address(addr.split("%")[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def resolve_public(host: str, port: int, resolver: Callable = socket.getaddrinfo) -> list[str]:
    """Every address `host` resolves to, only if ALL are public. Odd spellings of an IP (decimal, hex, octal, short forms) are resolved by the OS resolver, so they are judged by what they really are."""
    h = host.strip("[]").rstrip(".").lower()
    if not h or h in BLOCKED_NAMES or h.endswith(BLOCKED_SUFFIXES):
        raise NetError(f"{host} is not a public host")
    try:
        infos = resolver(h, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise NetError(f"cannot resolve {host}: {exc}") from None
    addrs = sorted({i[4][0] for i in infos})
    if not addrs:
        raise NetError(f"{host} has no address")
    bad = [a for a in addrs if not _ip_ok(a)]
    if bad:
        raise NetError(f"{host} resolves to a non-public address ({bad[0]}): refused")
    return addrs


def split_url(url: str) -> tuple[str, str, int, str]:
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise NetError("only http and https addresses with a host are allowed")
    if u.username or u.password:
        raise NetError("credentials inside the address are not allowed")
    port = u.port or (443 if u.scheme == "https" else 80)
    path = (u.path or "/") + (("?" + u.query) if u.query else "")
    return u.scheme, u.hostname, port, path


def _connect(scheme: str, host: str, ip: str, port: int, timeout: float) -> http.client.HTTPConnection:
    sock = socket.create_connection((ip, port), timeout=timeout)
    if scheme == "https":
        sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)      # certificate is checked against the NAME, the socket goes to the checked IP
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    conn.sock = sock
    return conn


def fetch(url: str, method: str = "GET", body: bytes | None = None, headers: dict | None = None, max_bytes: int = MAX_BYTES, max_redirects: int = 5,
          timeout: float = 20.0, resolver: Callable = socket.getaddrinfo, connect: Callable | None = None, allow_private: bool = False) -> tuple[int, dict, bytes, str]:
    """(status, headers, body, final_url). `connect(scheme, host, ip, port, timeout)` and `allow_private` exist for tests and for the owner's own private services."""
    method = method.upper()
    hdrs = {"User-Agent": "qalam/0.1", **(headers or {})}
    for _ in range(max_redirects + 1):
        scheme, host, port, path = split_url(url)
        ips = [socket.gethostbyname(host)] if allow_private else resolve_public(host, port, resolver)
        conn = (connect or _connect)(scheme, host, ips[0], port, timeout)
        try:
            conn.request(method, path, body=body, headers={**hdrs, "Host": host if port in (80, 443) else f"{host}:{port}"})
            r = conn.getresponse()
            if r.status in (301, 302, 303, 307, 308) and r.getheader("Location"):
                url = urllib.parse.urljoin(url, r.getheader("Location"))
                if r.status in (301, 302, 303) and method != "GET":
                    method, body = "GET", None
                continue
            data = r.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise NetError(f"response larger than {max_bytes} bytes")
            return r.status, dict(r.getheaders()), data, url
        finally:
            conn.close()
    raise NetError("too many redirects")
