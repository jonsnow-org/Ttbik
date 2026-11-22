"""Review note #1198 (P0) for Sham's own embedded computer: strict mode refuses commands while the host's private network cannot be blocked."""
import os
import unittest

import sham_computer as C


class Egress(unittest.TestCase):
    def setUp(self):
        self._old = (dict(C._EGRESS), os.environ.get("SHAM_COMPUTER_EGRESS_STRICT"))

    def tearDown(self):
        C._EGRESS.clear()
        C._EGRESS.update(self._old[0])
        if self._old[1] is None:
            os.environ.pop("SHAM_COMPUTER_EGRESS_STRICT", None)
        else:
            os.environ["SHAM_COMPUTER_EGRESS_STRICT"] = self._old[1]

    def test_default_allows_but_state_is_readable(self):
        os.environ.pop("SHAM_COMPUTER_EGRESS_STRICT", None)
        C._EGRESS["state"] = "not available (not root or no iptables): commands can reach the host's private network"
        self.assertEqual(C.egress_gate(), "")

    def test_strict_refuses_when_not_secure(self):
        os.environ["SHAM_COMPUTER_EGRESS_STRICT"] = "1"
        C._EGRESS["state"] = "partly blocked (2 firewall rules refused by the host)"
        self.assertIn("egress_not_secure", C.egress_gate())

    def test_strict_allows_when_secure(self):
        os.environ["SHAM_COMPUTER_EGRESS_STRICT"] = "1"
        C._EGRESS["state"] = "private IPv4/IPv6 ranges and metadata addresses blocked for computer commands"
        self.assertEqual(C.egress_gate(), "")


if __name__ == "__main__":
    unittest.main()
