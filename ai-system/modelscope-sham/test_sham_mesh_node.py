"""Sham 2's serving side as a mesh node: recall from mesh lessons inside drive(), lessons published after a successful run, off switch.
Offline: the relay is the in-process LocalHub (same semantics as the Worker); the chat's computer is a sandbox standing in for model_computer."""
import os
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "terminal"))
import mesh_net as MN  # noqa: E402
from mesh import Node  # noqa: E402
from mesh_crypto import Identity  # noqa: E402
from sandbox_terminal import SandboxTerminal  # noqa: E402
import sham_mesh_node as SMN  # noqa: E402
import sham_tldm_serve as S  # noqa: E402


class Chat:
    def __init__(self, table, folder):
        self.table, self.folder, self.max_steps, self.calls = table, folder, 3, []

    def writer(self, message, hist):
        self.calls.append(message)
        if hist:
            return "done: " + hist[-1][1][:40]
        cmd = self.table.get(message.split("\n")[0])
        return ("$ " + cmd) if cmd else "لا أعرف"

    def backend_factory(self, session):
        return SandboxTerminal(self.folder)


class ShamMeshNodeTest(unittest.TestCase):
    def setUp(self):
        self.hub = MN.LocalHub()
        self.tmp = tempfile.mkdtemp()
        os.environ["SHAM_TLDM_EVOLUTION_ROOT"] = os.path.join(self.tmp, "evo")
        SMN._STATE.update(net=None, error="", chat=None, propose=None)
        SMN._root = lambda: __import__("pathlib").Path(self.tmp) / "mesh"
        hub = self.hub
        self._orig = MN.RelayClient
        MN.RelayClient = lambda url, mesh, ident, timeout=15.0: MN.LocalRelay(hub, ident)

    def tearDown(self):
        MN.RelayClient = self._orig
        os.environ.pop("SHAM_MESH", None)
        if SMN._STATE.get("net"):
            SMN._STATE["net"].stop()

    def peer(self, table):
        ident = Identity.generate()
        d = tempfile.mkdtemp()
        open(os.path.join(d, "app.log"), "w").write("a\nb\n")
        return MN.NetMesh(Node(ident.id, SandboxTerminal(d), lambda t: table.get(t)), ident, MN.LocalRelay(self.hub, ident), heartbeat=0.3, poll_wait=1).start()

    def folder(self):
        d = tempfile.mkdtemp()
        open(os.path.join(d, "app.log"), "w").write("x\ny\nz\n")
        return d

    def test_turn_uses_a_mesh_lesson_without_a_model_call_and_runs_it_on_the_chats_own_computer(self):
        p = self.peer({"count the lines in the log": "wc -l app.log"})
        p.ask("count the lines in the log")
        time.sleep(0.3)
        chat = SMN.attach(Chat({}, self.folder()))
        self.assertTrue(chat._mesh_attached and SMN.status()["online"])
        reply, hist = S.drive(chat, "s1", "count the lines in the log")
        self.assertEqual(hist[0][0], "wc -l app.log")
        self.assertTrue(hist[0][1].startswith("3"), hist)                    # the CHAT's own file (3 lines), not the peer's (2)
        self.assertEqual(chat.calls, ["count the lines in the log"], "only the final reply needed the model")
        p.stop()

    def test_successful_commands_are_published_as_signed_lessons(self):
        chat = SMN.attach(Chat({"show errors": "grep -c y app.log"}, self.folder()))
        S.drive(chat, "s2", "show errors")
        time.sleep(0.5)
        self.assertTrue(any(L["command"] == "grep -c y app.log" and L["by"] == SMN._STATE["net"].ident.id for L in self.hub.lessons), self.hub.lessons)

    def test_private_tasks_are_not_published(self):
        chat = SMN.attach(Chat({"count lines in /home/omar/app.log": "wc -l app.log"}, self.folder()))
        S.drive(chat, "s3", "count lines in /home/omar/app.log")
        time.sleep(0.4)
        self.assertEqual(self.hub.lessons, [])

    def test_writer_attributes_survive_the_wrap(self):
        c = Chat({}, self.folder())

        def w(message, hist):
            return "ok"
        w.hints, w.mode = False, "loop"
        c.writer = w
        chat = SMN.attach(c)
        self.assertIsNot(chat.writer, w)
        self.assertEqual((chat.writer.hints, chat.writer.mode), (False, "loop"))

    def test_off_switch_leaves_the_chat_untouched(self):
        os.environ["SHAM_MESH"] = "0"
        c = Chat({}, self.folder())
        w = c.writer
        self.assertIs(SMN.attach(c).writer.__func__, w.__func__)
        self.assertFalse(SMN.status()["online"])


    def test_presence_at_startup_joins_without_a_chat_and_attach_reuses_that_node(self):
        os.environ.pop("SHAM_MESH_SERVE_PEERS", None)
        self.assertTrue(SMN.start_presence())
        end = time.time() + 5
        while time.time() < end and not (SMN._STATE.get("net") and SMN._STATE["net"].online):
            time.sleep(0.05)
        net = SMN._STATE["net"]
        self.assertTrue(net.online and SMN.status()["online"], SMN.status())
        self.assertIn(net.ident.id, self.hub.nodes)                          # visible to every peer before any T-LDM chat exists
        self.assertFalse(net.caps()["propose"], "serving proposals stays opt-in")
        self.assertIsNone(net.me.propose("list the files"))
        chat = SMN.attach(Chat({}, self.folder()))
        self.assertIs(SMN._STATE["net"], net, "the chat reuses the start-up node (one node per Studio process)")
        self.assertTrue(chat._mesh_attached)
        self.assertIsNone(SMN._STATE.get("propose"))

    def test_presence_off_switches(self):
        os.environ["SHAM_MESH_PRESENCE"] = "0"
        try:
            self.assertFalse(SMN.start_presence())
        finally:
            os.environ.pop("SHAM_MESH_PRESENCE", None)
        os.environ["SHAM_MESH"] = "0"
        self.assertFalse(SMN.start_presence())

if __name__ == "__main__":
    unittest.main()
