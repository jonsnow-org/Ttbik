"""Tests of the owner's policy decision of 2026-11-18 (approvals.py): model_computer + the owner's allow/deny for sensitive commands. Stdlib only, no torch.
Run: python3 ai-system/terminal/test_approvals.py"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "tldm"))
import approvals as A  # noqa: E402
from app_port import AppPort  # noqa: E402
from backends import ComputerBackend  # noqa: E402

TESTS = []


def test(f):
    TESTS.append(f)
    return f


class FakeComputer:
    """Stands in for Sham's Computer: same `execute("computer_run", {"command"})` -> "exit code N\\n<out>" shape, runs with a real shell in a temp home."""

    def __init__(self):
        self.home = tempfile.mkdtemp(prefix="approvals_test_")
        self.calls = []

    def execute(self, name, args):
        self.calls.append((name, args.get("command")))
        p = subprocess.run(args["command"], shell=True, cwd=self.home, capture_output=True, text=True, timeout=10)
        return f"exit code {p.returncode}\n{p.stdout}{p.stderr}"


def chat(script, comp, confirm, policy="model_computer_approvals"):
    import serve_adapter
    it = iter(script)
    seen = []
    c = serve_adapter.TLDMChat(lambda task, hist: (seen.append(list(hist)), next(it))[1], lambda s: ComputerBackend(comp, policy=policy), confirm=confirm)
    return c, seen


@test
def the_classifier_keeps_the_base_unrestricted_and_asks_only_for_sensitive_commands():
    home = "/tmp/approvals_home"
    for cmd in ("ls", "echo $HOME", "cat a | wc -l", "python3 -c 'print(1)'", "echo hi > out.txt", "mkdir new", "grep x app.log 2>/dev/null", "seq 3 | sort -r"):
        assert A.sensitive(cmd, home) == "", cmd
    for cmd in ("rm -rf x", "ls; git push", "git status", "sudo ls", "curl http://x", "pip install x", "python3 -m pip install x", "mv a b",
                "FOO=1 git status", "timeout 5 rm x", "echo $(curl x)", "echo `wget x`", "echo hi > /etc/x", "find . -delete",
                "echo ghp_abcdefghijklmnopqrstuvwxyz0123456789", "chmod 777 f", "kill 1", "ssh host", "docker ps"):
        assert A.sensitive(cmd, home), cmd


@test
def the_owners_default_with_sham_tldm_is_model_computer_plus_approvals_and_strict_is_only_an_option():
    old = os.environ.pop("SHAM_TLDM_POLICY", None)
    try:
        assert A.default_policy() == "model_computer_approvals"
        os.environ["SHAM_TLDM_POLICY"] = "strict"
        assert A.default_policy() == "strict"
        os.environ["SHAM_TLDM_POLICY"] = "nonsense"
        assert A.default_policy() == "model_computer_approvals"
    finally:
        os.environ.pop("SHAM_TLDM_POLICY", None)
        if old is not None:
            os.environ["SHAM_TLDM_POLICY"] = old
    import inspect
    import sham_binding
    assert inspect.signature(sham_binding.ShamEmbeddedBackend).parameters["policy"].default is None, "the binding takes A.default_policy()"


@test
def a_sensitive_command_without_approval_never_reaches_the_computer():
    comp = FakeComputer()
    open(os.path.join(comp.home, "keep.txt"), "w").write("x")
    b = ComputerBackend(comp, policy="model_computer_approvals")
    r = b.run("rm keep.txt")
    assert not r.ok and r.needs_confirmation and "owner's approval" in r.refused
    assert comp.calls == [] and os.path.exists(os.path.join(comp.home, "keep.txt"))
    for confirm in (None, lambda q: False, lambda q: 1 / 0):            # no channel, a "no", a broken channel: all = not run
        c, _ = chat(["$ rm keep.txt", "done"], comp, confirm)
        c.respond("s", "delete keep.txt")
        assert comp.calls == [] and os.path.exists(os.path.join(comp.home, "keep.txt")), confirm


@test
def an_approved_command_runs_once_and_the_question_says_what_and_why():
    comp = FakeComputer()
    open(os.path.join(comp.home, "keep.txt"), "w").write("x")
    asked = []
    c, seen = chat(["$ rm keep.txt", "$ ls", "deleted"], comp, lambda q: (asked.append(q), True)[1])
    reply, events = c.respond("s", "delete keep.txt")
    assert reply == "deleted" and events[0].ok and not os.path.exists(os.path.join(comp.home, "keep.txt"))
    assert comp.calls == [("computer_run", "rm keep.txt"), ("computer_run", "ls")], "approved: run exactly once; ls needed no approval"
    assert len(asked) == 1 and "$ rm keep.txt" in asked[0] and "approval" in asked[0]
    assert c.last_info["approvals"] == 1 and c.last_info["denied"] == 0


@test
def a_denied_command_gives_the_model_a_clear_result_and_the_loop_continues():
    comp = FakeComputer()
    c, seen = chat(["$ git push", "$ echo ok", "I could not push: the owner said no."], comp, lambda q: False)
    reply, events = c.respond("s", "push my work")
    assert comp.calls == [("computer_run", "echo ok")]
    first = seen[1][0]
    assert first[0] == "git push" and first[1].startswith("denied by the owner: `git push` was not run"), first
    assert reply.startswith("I could not push") and c.last_info["denied"] == 1
    c2, seen2 = chat(["$ curl http://example.com", "no network"], comp, None)
    c2.respond("s", "fetch")
    assert "no approval channel is connected" in seen2[1][0][1]


@test
def the_approval_goes_through_the_apps_existing_confirmation_or_ask_user():
    taps = []
    port = AppPort(lambda env, ok: "", ["ask_user"], confirm=lambda q: (taps.append(q), True)[1])
    assert A.app_confirm(port)("Sham wants to run ...") is True and taps == ["Sham wants to run ..."], "the app's own «نفّذ» tap"
    for answer, want in (("نعم", True), ("yes, go ahead", True), ("no", False), ("لا", False)):
        p = AppPort(lambda env, ok, a=answer: a, ["ask_user"])
        assert A.app_confirm(p)("allow?") is want, answer
        assert p.sent and "ask_user" in p.sent[-1][0], "asked with the app's ask_user tool, in Sham's <tool_call> envelope"
    assert A.app_confirm(AppPort(lambda env, ok: "yes", []))("allow?") is False, "no confirmation and no ask_user loaded = deny"


@test
def strict_is_still_available_and_model_computer_alone_is_unchanged():
    comp = FakeComputer()
    assert ComputerBackend(comp, policy="model_computer").run("echo $HOME").ok
    assert ComputerBackend(comp, policy="model_computer").run("true; true").ok, "no approvals in plain model_computer"
    n = len(comp.calls)
    assert ComputerBackend(comp, policy="strict").run("git status", confirm=True).refused and len(comp.calls) == n


if __name__ == "__main__":
    bad = 0
    for f in TESTS:
        try:
            f()
            print("PASS", f.__name__)
        except Exception as e:
            import traceback
            traceback.print_exc()
            print("FAIL", f.__name__, repr(e))
            bad += 1
    print(f"{len(TESTS) - bad}/{len(TESTS)} passed")
    sys.exit(1 if bad else 0)
