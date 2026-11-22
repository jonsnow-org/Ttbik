"""A tiny filtering HTTP/HTTPS proxy for the computer's graphical browser (review note #1198, P0, §4.2).

Why: the desktop browser used to check ONE url before Chromium started; a page could then redirect, embed or fetch (XHR, iframe, websocket, DNS rebinding) a private address
(10/8, 172.16/12, 192.168/16, link-local and the cloud metadata address 100.100.100.200, IPv6 ULA / link-local). Chromium is started with --proxy-server pointing here, so
EVERY request goes through one place that resolves the name ONCE, refuses it when any answer is not a public address, and connects to the resolved IP itself (a second DNS
answer can never change the destination). Loopback is left to Chromium's own bypass (a session's own preview server, as before).

Never raises into the caller: if the proxy cannot start, ensure() returns 0 and the browser starts without it (the old behaviour). DESKTOP_EGRESS_PROXY=off disables it.
"""
from __future__ import annotations

import ipaddress
import os
import socket
import threading

_LOCK = threading.Lock()
_STATE: dict = {"port": 0, "server": None}
BUFFER = 65536
CONNECT_TIMEOUT = 15
METADATA = ipaddress.ip_address("100.100.100.200")


def allowed_ip(text: str) -> bool:
    """True only for a public (globally routable) address; private, loopback, link-local, CGNAT, multicast, reserved and the metadata address are refused."""
    try:
        ip = ipaddress.ip_address(text)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if ip == METADATA:
        return False
    return ip.is_global and not (ip.is_multicast or ip.is_reserved or ip.is_link_local or ip.is_loopback or ip.is_private)


def resolve_public(host: str, port: int) -> str:
    """The one IP to connect to, or "" when the name is unknown or ANY of its answers is not public."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        return ""
    ips = []
    for info in infos:
        ip = info[4][0]
        if not allowed_ip(ip):
            return ""
        ips.append(ip)
    return ips[0] if ips else ""


def _pipe(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            data = src.recv(BUFFER)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def _deny(client: socket.socket, why: str) -> None:
    body = ("blocked by the computer's egress filter: " + why).encode()
    try:
        client.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
    except OSError:
        pass


def _split_host(target: str, default_port: int) -> tuple[str, int]:
    if target.startswith("["):                                   # [v6]:port
        host, _, rest = target[1:].partition("]")
        return host, int(rest[1:]) if rest.startswith(":") and rest[1:].isdigit() else default_port
    host, sep, port = target.rpartition(":")
    if sep and port.isdigit() and ":" not in host:
        return host, int(port)
    return target, default_port


def _handle(client: socket.socket) -> None:
    upstream = None
    try:
        client.settimeout(30)
        head = b""
        while b"\r\n\r\n" not in head and len(head) < 65536:
            chunk = client.recv(BUFFER)
            if not chunk:
                return
            head += chunk
        header, _, rest = head.partition(b"\r\n\r\n")
        lines = header.decode("latin-1").split("\r\n")
        parts = lines[0].split(" ")
        if len(parts) < 3:
            return _deny(client, "bad request")
        method, target = parts[0].upper(), parts[1]
        if method == "CONNECT":
            host, port = _split_host(target, 443)
            ip = resolve_public(host, port)
            if not ip:
                return _deny(client, f"{host} is not a public address")
            upstream = socket.create_connection((ip, port), timeout=CONNECT_TIMEOUT)
            client.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
            if rest:
                upstream.sendall(rest)
        else:
            if not target.lower().startswith("http://"):
                return _deny(client, "only absolute http:// proxy requests are served")
            without = target[7:]
            hostport, _, path = without.partition("/")
            host, port = _split_host(hostport, 80)
            ip = resolve_public(host, port)
            if not ip:
                return _deny(client, f"{host} is not a public address")
            upstream = socket.create_connection((ip, port), timeout=CONNECT_TIMEOUT)
            kept = [l for l in lines[1:] if not l.lower().startswith(("proxy-connection:", "connection:"))]
            upstream.sendall((f"{method} /{path} {parts[2]}\r\n" + "\r\n".join(kept) + "\r\nConnection: close\r\n\r\n").encode("latin-1") + rest)
        client.settimeout(None)
        upstream.settimeout(None)
        t = threading.Thread(target=_pipe, args=(upstream, client), daemon=True)
        t.start()
        _pipe(client, upstream)
        t.join(timeout=5)
    except (OSError, ValueError):
        pass
    finally:
        for s in (client, upstream):
            try:
                if s:
                    s.close()
            except OSError:
                pass


def _serve(server: socket.socket) -> None:
    while True:
        try:
            client, _ = server.accept()
        except OSError:
            return
        threading.Thread(target=_handle, args=(client,), daemon=True).start()


def ensure() -> int:
    """Starts the proxy once and returns its loopback port; 0 when disabled or when it could not start (the browser then runs as before)."""
    if os.environ.get("DESKTOP_EGRESS_PROXY", "on").strip().lower() == "off":
        return 0
    with _LOCK:
        if _STATE["port"]:
            return int(_STATE["port"])
        try:
            server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind(("127.0.0.1", 0))
            server.listen(64)
            _STATE["server"], _STATE["port"] = server, server.getsockname()[1]
            threading.Thread(target=_serve, args=(server,), daemon=True).start()
        except OSError:
            return 0
        return int(_STATE["port"])


if __name__ == "__main__":
    for bad in ("127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.9", "169.254.169.254", "100.100.100.200", "100.64.0.1", "::1", "fe80::1", "fc00::1", "::ffff:10.0.0.1", "0.0.0.0", "224.0.0.1", "nope"):
        assert not allowed_ip(bad), bad
    for good in ("8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"):
        assert allowed_ip(good), good
    assert _split_host("example.com:8443", 443) == ("example.com", 8443) and _split_host("[::1]:80", 443) == ("::1", 80) and _split_host("example.com", 443) == ("example.com", 443)
    print("egress_proxy self-test ok")
