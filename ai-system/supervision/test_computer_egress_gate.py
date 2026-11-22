"""Review note #1198 (P0): the computer fails closed on request when the host's private network cannot be blocked, and always reports it."""
import os
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "modelscope-media"))
import computer_box as box  # noqa: E402


class EgressGate(unittest.TestCase):
    def setUp(self):
        self._old = (dict(box.STATE), os.environ.get("COMPUTER_EGRESS_STRICT"))

    def tearDown(self):
        box.STATE.clear()
        box.STATE.update(self._old[0])
        if self._old[1] is None:
            os.environ.pop("COMPUTER_EGRESS_STRICT", None)
        else:
            os.environ["COMPUTER_EGRESS_STRICT"] = self._old[1]

    def test_default_runs_but_reports_unsecured(self):
        os.environ.pop("COMPUTER_EGRESS_STRICT", None)
        box.STATE["egress"] = "not available (no iptables or not root): commands can reach the host's private network"
        self.assertIsNone(box.egress_gate())
        self.assertFalse(box.egress_secure())

    def test_strict_refuses_when_not_secure(self):
        os.environ["COMPUTER_EGRESS_STRICT"] = "1"
        box.STATE["egress"] = "partly blocked (2 firewall rules refused by the host)"
        refused = box.egress_gate()
        self.assertFalse(refused["ok"])
        self.assertIn("egress_not_secure", refused["error"])

    def test_strict_allows_when_secure(self):
        os.environ["COMPUTER_EGRESS_STRICT"] = "1"
        box.STATE["egress"] = "private IPv4/IPv6 ranges and metadata addresses blocked for computer sessions"
        self.assertIsNone(box.egress_gate())
        self.assertTrue(box.egress_secure())

    def test_status_shows_it(self):
        st = box.status()
        self.assertIn("egress_secure", st)
        self.assertIn("storage_mode", st)


if __name__ == "__main__":
    unittest.main()
