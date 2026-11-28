import http.server
import json
import socket
import threading

import pytest

from qalam import executors, netguard, tools
from qalam.audit import AuditLog, EmergencyStop
from qalam.executors import Runtime, coverage, run_tool

PUBLIC = [(2, 1, 6, "", ("93.184.216.34", 80))]


def test_every_tool_is_classified_and_the_claim_is_honest():
    cov = coverage()
    assert set(cov) == set(tools.REGISTRY) and set(cov.values()) <= {"executor", "agent", "connector", "model", "runtime"}
    counts = {k: sum(v == k for v in cov.values()) for k in set(cov.values())}
    assert counts["executor"] >= 100 and counts["model"] == 7                                  # the model-dependent tools are named, not hidden
    assert cov["generate_video"] == "model" and cov["browser"] == "runtime" and cov["fin_backtest"] == "executor" and cov["trade_live_order"] == "executor"


@pytest.fixture()
def rt(tmp_path):
    return Runtime(tmp_path / "ws", audit=AuditLog(tmp_path / "audit.jsonl"), stop=EmergencyStop(tmp_path / "STOP"))


def test_command_confinement(rt, monkeypatch):
    monkeypatch.setenv("QALAM_TEST_SECRET", "hunter2")
    ok, out = run_tool(rt, "computer_run", {"command": "echo hello"})
    assert ok and "hello" in out
    assert run_tool(rt, "computer_run", {"command": "echo a; echo b"})[1].strip().endswith("a; echo b")   # no shell: the operators are plain text
    assert "$(whoami)" in run_tool(rt, "computer_run", {"command": "echo $(whoami)"})[1]
    assert "not on the allowed list" in run_tool(rt, "computer_run", {"command": "curl http://x"})[1]
    assert "leaves the workspace" in run_tool(rt, "computer_run", {"command": "cat ../x"})[1] or not run_tool(rt, "computer_run", {"command": "cat ../x"})[0]
    assert not run_tool(rt, "computer_run", {"command": "cat /etc/passwd"})[0]
    ok, out = run_tool(rt, "computer_run", {"command": "python -c 'import os;print(os.environ.get(\"QALAM_TEST_SECRET\"))'"})
    assert ok and "hunter2" not in out and "None" in out                                           # no secret reaches a command


def test_destructive_commands_need_the_typed_confirmation():
    for cmd in ("rm -rf build", "git push --force origin main", "git reset --hard HEAD~3", "git clean -fdx", "git branch -D x", "drop table users", "ls | sh"):
        assert tools.validate("computer_run", {"command": cmd}, {"computer"}).needs_confirmation, cmd
    for cmd in ("ls -la", "git status", "git push origin feature", "python -m pytest", "rm notes.txt"):
        assert not tools.validate("computer_run", {"command": cmd}, {"computer"}).needs_confirmation, cmd


def test_scaffold_then_tests_pass(rt):
    assert run_tool(rt, "project_scaffold", {"kind": "python", "name": "demo"})[0]
    ok, out = run_tool(rt, "run_tests", {"cwd": "demo"})
    assert ok and "1 passed" in out, out
    assert not run_tool(rt, "project_scaffold", {"kind": "python", "name": "demo"})[0]            # never overwrites
    assert not run_tool(rt, "project_scaffold", {"kind": "android", "name": "app"})[0]            # says so instead of faking it
    assert not run_tool(rt, "project_scaffold", {"kind": "python", "name": "../x"})[0]
    assert run_tool(rt, "package_release", {"path": "demo"})[0] and (rt.ws.root / "demo.zip").exists()


def test_install_packages_validates_and_logs(rt):
    rt.dry_run_installs = True
    ok, txt = run_tool(rt, "install_packages", {"manager": "pip", "packages": ["requests>=2", "numpy"]})
    assert ok and "dry run" in txt
    for bad in (["-e git+http://x"], ["a b"], ["--index-url=http://evil"], [], ["x" * 200]):
        assert not run_tool(rt, "install_packages", {"manager": "pip", "packages": bad})[0], bad
    assert any(e["kind"] == "package_install" for e in rt.audit.entries())


def test_emergency_stop_blocks_everything_but_reading(rt):
    assert run_tool(rt, "computer_write", {"path": "a.txt", "content": "x"})[0]
    rt.stop.engage("test")
    assert not run_tool(rt, "computer_write", {"path": "b.txt", "content": "x"})[0]
    assert run_tool(rt, "computer_read", {"path": "a.txt"})[0]
    rt.stop.release()
    assert run_tool(rt, "computer_write", {"path": "b.txt", "content": "x"})[0]


def test_netguard_refuses_private_destinations():
    for host in ("localhost", "127.0.0.1", "10.1.2.3", "192.168.0.9", "169.254.169.254", "172.16.0.1", "0.0.0.0", "2130706433", "0x7f000001", "127.1", "[::1]", "metadata.google.internal", "printer.local", "100.64.0.1"):
        with pytest.raises(netguard.NetError):
            netguard.resolve_public(host, 80)
    with pytest.raises(netguard.NetError):                                                          # a public NAME that resolves inside
        netguard.resolve_public("evil.example", 80, resolver=lambda *a, **k: [(2, 1, 6, "", ("10.0.0.5", 80))])
    with pytest.raises(netguard.NetError):                                                          # one private address among public ones is enough to refuse
        netguard.resolve_public("mixed.example", 80, resolver=lambda *a, **k: PUBLIC + [(2, 1, 6, "", ("192.168.1.1", 80))])
    assert netguard.resolve_public("ok.example", 80, resolver=lambda *a, **k: PUBLIC) == ["93.184.216.34"]
    with pytest.raises(netguard.NetError):
        netguard.split_url("ftp://x.com/")
    with pytest.raises(netguard.NetError):
        netguard.split_url("http://user:pw@x.com/")
    for u in ("http://127.0.0.1/", "http://10.0.0.1/x", "http://[::1]/", "http://printer.local/", "http://0.0.0.0/"):
        assert not tools.validate("fetch_page", {"url": u}, {"web"}).ok, u
    assert tools.validate("fetch_page", {"url": "https://example.com/a?b=1"}, {"web"}).ok


class _H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/redir":
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data")
            self.end_headers()
        elif self.path == "/page":
            body = b"<html><script>evil()</script><h1>Hello &amp; welcome</h1><p>text</p></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/big":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"x" * 5000)
        elif self.path == "/rss":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"<rss><channel><item><title>One</title><link>http://a/1</link></item><item><title>Two</title><link>http://a/2</link></item></channel></rss>")
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *a):
        pass


@pytest.fixture()
def server():
    srv = http.server.HTTPServer(("127.0.0.1", 0), _H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()


def _transport(port, seen=None):
    """The real netguard.fetch with the DNS answer faked as public and the socket pointed at the local test server."""
    def go(url, method="GET", body=None, headers=None, **kw):
        def connect(scheme, host, ip, p, timeout):
            if seen is not None:
                seen.append(ip)
            return netguard.http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
        return netguard.fetch(url, method, body, headers, resolver=lambda host, *a, **k: [(2, 1, 6, "", (host, 80))] if host[0].isdigit() else PUBLIC, connect=connect, **kw)
    return go


def test_web_tools_through_the_guard(rt, server):
    seen = []
    rt.transport = _transport(server, seen)
    ok, txt = run_tool(rt, "fetch_page", {"url": "http://site.example/page"})
    assert ok and "Hello & welcome" in txt and "evil()" not in txt
    assert seen == ["93.184.216.34"]                                                             # it connected to the address it had checked
    ok, txt = run_tool(rt, "fetch_page", {"url": "http://site.example/redir"})
    assert not ok and "non-public" in txt                                                         # a redirect into the metadata address is refused
    assert not run_tool(rt, "fetch_page", {"url": "http://site.example/missing"})[0]
    assert json.loads(run_tool(rt, "rss_read", {"url": "http://site.example/rss"})[1])[1]["title"] == "Two"
    rt.limits.download_bytes = 1000
    ok, txt = run_tool(rt, "download_file", {"url": "http://site.example/big", "path": "dl/big.bin"})
    assert not ok and "larger" in txt
    rt.limits.download_bytes = 10_000
    ok, _ = run_tool(rt, "download_file", {"url": "http://site.example/big", "path": "dl/big.bin"})
    assert ok and (rt.ws.root / "dl" / "big.bin").stat().st_size == 5000


def test_github_client_never_leaks_the_token(rt):
    calls = []

    def fake(url, method="GET", body=None, headers=None, **kw):
        calls.append((method, url, headers))
        if url.endswith("/contents/README.md"):
            import base64
            return 200, {}, json.dumps({"encoding": "base64", "content": base64.b64encode(b"# hi").decode()}).encode(), url
        return 200, {}, json.dumps({"number": 7}).encode(), url
    rt.transport = fake
    ok, txt = run_tool(rt, "github_read_file", {"repo": "o/r", "path": "README.md"})
    assert not ok and "not connected" in txt                                                      # no token supplied: it says so, nothing is sent
    assert not calls
    rt.secrets = lambda n: "ghp_SECRETTOKEN123456" if n == "github_token" else None
    ok, txt = run_tool(rt, "github_read_file", {"repo": "o/r", "path": "README.md"})
    assert ok and txt == "# hi" and calls[0][2]["Authorization"] == "Bearer ghp_SECRETTOKEN123456"
    ok, txt = run_tool(rt, "github_create_issue", {"repo": "o/r", "title": "t"})
    assert ok and "SECRETTOKEN" not in txt and calls[-1][0] == "POST"
    assert not any("SECRETTOKEN" in json.dumps(e) for e in rt.audit.entries())                  # the audit log has no secret either
    assert tools.validate("github_merge_pr", {"repo": "o/r", "number": 1}, {"github"}).needs_confirmation


def test_memory_notes_and_schedules(rt):
    nid = run_tool(rt, "memory_note", {"text": "the staging server is called orion", "tags": ["infra"]})[1]
    run_tool(rt, "memory_note", {"text": "lunch is at noon"})
    hits = json.loads(run_tool(rt, "recall", {"query": "which server is staging"})[1])
    assert hits and hits[0]["id"] == nid
    assert run_tool(rt, "memory_forget", {"id": nid})[0] and json.loads(run_tool(rt, "recall", {"query": "staging orion"})[1]) == []
    assert tools.validate("schedule_create", {"when": "tomorrow 9am", "task": "x"}, {"schedule"}).needs_approval
    assert run_tool(rt, "schedule_create", {"when": "tomorrow 9am", "task": "report"})[0]
    assert "report" in run_tool(rt, "schedule_list", {})[1]
    assert any(e["kind"] == "schedule_create" for e in rt.audit.entries())


def test_email_needs_the_owners_account(rt, monkeypatch):
    args = {"to": "a@b.com", "subject": "s", "body": "b"}
    assert tools.validate("send_email", args, {"web"}).needs_approval
    ok, txt = run_tool(rt, "send_email", args)
    assert not ok and "no mail account" in txt
    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=0):
            sent["host"] = host

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self):
            pass

        def login(self, u, p):
            sent["login"] = u

        def send_message(self, m):
            sent["to"] = m["To"]
    import smtplib
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    rt.secrets = lambda n: {"smtp_host": "smtp.example.com", "smtp_user": "me@example.com", "smtp_password": "pw"}.get(n)
    ok, txt = run_tool(rt, "send_email", args)
    assert ok and sent == {"host": "smtp.example.com", "login": "me@example.com", "to": "a@b.com"} and "pw" not in txt


def test_files_and_finance_tools_run_through_the_same_door(rt):
    assert run_tool(rt, "file_write", {"path": "x/a.txt", "content": "hello"})[0]
    assert run_tool(rt, "file_read", {"path": "x/a.txt"})[1].strip().endswith("hello")
    assert not run_tool(rt, "file_read", {"path": "../a.txt"})[0]
    ok, txt = run_tool(rt, "fin_option", {"spot": 100.0, "strike": 100.0, "t": 1.0, "rate": 0.05, "vol": 0.2})
    assert ok and abs(json.loads(txt)["price"] - 10.4506) < 1e-3
    ok, txt = run_tool(rt, "generate_image", {"prompt": "x"})
    assert not ok and "model" in txt                                                              # a model tool without the model says so
    assert not run_tool(rt, "not_a_tool", {})[0]
