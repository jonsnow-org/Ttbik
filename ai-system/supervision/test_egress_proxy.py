"""Review note #1198 (P0): the graphical browser's proxy refuses private destinations for every request kind and never lets a second DNS answer change the target."""
import pathlib
import socket
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "modelscope-media"))
import egress_proxy as P  # noqa: E402


def ask(port: int, raw: bytes) -> bytes:
    with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
        s.sendall(raw)
        s.settimeout(5)
        out = b""
        try:
            while True:
                chunk = s.recv(4096)
                if not chunk:
                    break
                out += chunk
        except socket.timeout:
            pass
        return out


class Proxy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = P.ensure()

    def test_started_on_loopback(self):
        self.assertGreater(self.port, 0)
        self.assertEqual(P.ensure(), self.port)             # idempotent

    def test_connect_to_private_and_metadata_is_refused(self):
        for target in ("10.0.0.5:443", "169.254.169.254:80", "100.100.100.200:80", "192.168.1.1:22", "[::1]:80", "[fe80::1]:80"):
            out = ask(self.port, f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n".encode())
            self.assertTrue(out.startswith(b"HTTP/1.1 403"), (target, out[:60]))

    def test_name_that_resolves_to_loopback_is_refused(self):
        out = ask(self.port, b"CONNECT localhost:80 HTTP/1.1\r\nHost: localhost\r\n\r\n")
        self.assertTrue(out.startswith(b"HTTP/1.1 403"), out[:60])

    def test_plain_http_to_private_is_refused(self):
        out = ask(self.port, b"GET http://10.1.1.1/admin HTTP/1.1\r\nHost: 10.1.1.1\r\n\r\n")
        self.assertTrue(out.startswith(b"HTTP/1.1 403"), out[:60])

    def test_non_absolute_request_is_refused(self):
        out = ask(self.port, b"GET /x HTTP/1.1\r\nHost: example.com\r\n\r\n")
        self.assertTrue(out.startswith(b"HTTP/1.1 403"), out[:60])

    def test_a_name_with_one_private_answer_is_refused(self):
        real = P.socket.getaddrinfo
        P.socket.getaddrinfo = lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 80)), (2, 1, 6, "", ("10.0.0.7", 80))]    # public + private: rebinding style
        try:
            self.assertEqual(P.resolve_public("evil.example", 80), "")
        finally:
            P.socket.getaddrinfo = real


if __name__ == "__main__":
    unittest.main()
