"""Credential-free regression tests for the Run #6 ModelScope donor-check failure.

Run #6 (Actions run 44499208857, 2026-11-19) failed the Sham 2 donor preflight with

    TypeError: snapshot_download() got an unexpected keyword argument 'endpoint'

because ``check_modelscope_donor`` handed ``endpoint=`` straight to ModelScope's
``snapshot_download()``.  modelscope 1.35.0 -- the version installed inside the
dedicated Studio ``novaai2026/sham2-tldm`` -- has no ``endpoint`` parameter at
all; the CN site has to arrive through ``MODELSCOPE_ENDPOINT`` instead.

``_snapshot_download_compatible`` now derives its keyword arguments from
``inspect.signature()``.  These tests pin that contract so the Run #6 failure
cannot come back silently.

Everything here runs offline against ordinary local callables: no token, no
network, and no ``modelscope`` install.  Run with:

    python -m unittest discover -s ai-system/tldm/sham_tldm -p 'test_snapshot_download_compat.py' -v
"""
from __future__ import annotations

import importlib
import inspect
import pathlib
import sys
import unittest

MODULE_DIR = pathlib.Path(__file__).resolve().parent
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

sham2_unified = importlib.import_module("sham2_unified")
_snapshot_download_compatible = sham2_unified._snapshot_download_compatible

TOKEN = "unit-test-token-not-a-credential"
ENDPOINT = "https://www.modelscope.cn"
PATTERNS = ["final_merged.pt"]

# The real parameter list of modelscope 1.35.0's
# modelscope.hub.snapshot_download.snapshot_download, copied from the verified
# donor preflight report of run 44558281864 (snapshot_download_parameters).
MODELSCOPE_1_35_0_PARAMETERS = (
    "model_id", "revision", "cache_dir", "user_agent", "local_files_only",
    "cookies", "ignore_file_pattern", "allow_file_pattern", "local_dir",
    "allow_patterns", "ignore_patterns", "max_workers", "repo_id",
    "repo_type", "enable_file_lock", "progress_callbacks", "token",
)


class Recorder:
    """Records the keyword arguments an SDK stand-in actually receives."""

    def __init__(self):
        self.calls = []


def modelscope_1_35_0_snapshot_download(recorder, **stub):
    """Build a stand-in with exactly the modelscope 1.35.0 signature.

    The signature is explicit (no ``**kwargs``), so Python itself rejects any
    unsupported keyword argument -- including ``endpoint``.  A stand-in that
    accepts ``**kwargs`` would let the Run #6 bug pass unnoticed, which is why
    the existing in-file self-test missed it.
    """

    def snapshot_download(
        model_id=None, revision=None, cache_dir=None, user_agent=None,
        local_files_only=False, cookies=None, ignore_file_pattern=None,
        allow_file_pattern=None, local_dir=None, allow_patterns=None,
        ignore_patterns=None, max_workers=None, repo_id=None,
        repo_type="model", enable_file_lock=None, progress_callbacks=None,
        token=None,
    ):
        recorder.calls.append({
            "model_id": model_id,
            "allow_file_pattern": allow_file_pattern,
            "allow_patterns": allow_patterns,
            "max_workers": max_workers,
            "token": token,
            "cookies": cookies,
        })
        return stub.get("result", "/tmp/modelscope-1.35.0-snapshot")

    return snapshot_download


class SnapshotDownloadCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.recorder = Recorder()
        self.sleeps = []

    def _call(self, sdk, diagnostics=None, max_attempts=3):
        return _snapshot_download_compatible(
            sdk,
            "novaai2026/sham-v2",
            PATTERNS,
            TOKEN,
            ENDPOINT,
            diagnostics=diagnostics,
            max_attempts=max_attempts,
            sleep_fn=self.sleeps.append,
        )

    # -- the exact Run #6 regression -------------------------------------

    def test_1_35_0_signature_has_no_endpoint_parameter(self):
        """Guard the premise: modelscope 1.35.0 exposes no endpoint kwarg."""
        sdk = modelscope_1_35_0_snapshot_download(self.recorder)
        parameters = set(inspect.signature(sdk).parameters)
        self.assertEqual(parameters, set(MODELSCOPE_1_35_0_PARAMETERS))
        self.assertNotIn("endpoint", parameters)

    def test_never_passes_endpoint_when_signature_lacks_it(self):
        """Run #6: endpoint must not reach an SDK that cannot accept it."""
        sdk = modelscope_1_35_0_snapshot_download(self.recorder)

        # A TypeError here is exactly the Run #6 failure.
        result = self._call(sdk)

        self.assertEqual(result, "/tmp/modelscope-1.35.0-snapshot")
        self.assertEqual(len(self.recorder.calls), 1)
        received = self.recorder.calls[0]
        self.assertNotIn("endpoint", received)
        self.assertNotIn("endpoint", inspect.signature(sdk).parameters)
        # The supported arguments still travel as real keyword arguments.
        self.assertEqual(received["model_id"], "novaai2026/sham-v2")
        self.assertEqual(received["allow_file_pattern"], PATTERNS)
        self.assertEqual(received["max_workers"], 1)
        self.assertEqual(received["token"], TOKEN)

    def test_run6_direct_call_shape_still_reproduces_the_type_error(self):
        """The stand-in must still reproduce Run #6 if the direct call returns.

        This keeps the fixture honest: it proves the simulation above really is
        capable of raising the error the shim now avoids.
        """
        sdk = modelscope_1_35_0_snapshot_download(self.recorder)
        with self.assertRaises(TypeError) as caught:
            sdk("novaai2026/sham-v2", allow_patterns=PATTERNS, max_workers=1,
                token=TOKEN, endpoint=ENDPOINT)
        self.assertIn("endpoint", str(caught.exception))
        self.assertEqual(self.recorder.calls, [])

    def test_endpoint_goes_through_env_fallback_when_unsupported(self):
        """With no endpoint kwarg, the CN site must be declared an env fallback."""
        diagnostics = {}
        self._call(modelscope_1_35_0_snapshot_download(self.recorder), diagnostics)

        self.assertIn("endpoint", diagnostics["snapshot_download_env_fallbacks"])
        self.assertEqual(diagnostics["snapshot_download_kwargs_used"],
                         ["allow_file_pattern", "max_workers", "token"])
        self.assertEqual(diagnostics["snapshot_download_auth_mode"], "token-parameter")
        self.assertNotIn("endpoint", diagnostics["snapshot_download_kwargs_used"])

    def test_endpoint_is_forwarded_only_when_the_signature_supports_it(self):
        """The shim is signature-driven, not hard-coded to drop endpoint."""
        def sdk_with_endpoint(model_id=None, allow_file_pattern=None,
                              max_workers=None, token=None, endpoint=None):
            self.recorder.calls.append({"endpoint": endpoint, "token": token})
            return "/tmp/snapshot-with-endpoint"

        diagnostics = {}
        self._call(sdk_with_endpoint, diagnostics)
        self.assertEqual(self.recorder.calls[0]["endpoint"], ENDPOINT)
        self.assertEqual(diagnostics["snapshot_download_env_fallbacks"], [])

    def test_older_signature_uses_allow_file_pattern(self):
        """Older SDKs expose only allow_file_pattern; the shim must pick it."""
        def sdk_old(model_id=None, allow_file_pattern=None, max_workers=None,
                    token=None):
            self.recorder.calls.append({"allow_file_pattern": allow_file_pattern})
            return "/tmp/snapshot-old"

        self._call(sdk_old)
        self.assertEqual(self.recorder.calls[0]["allow_file_pattern"], PATTERNS)

    def test_missing_pattern_parameter_is_refused(self):
        """A signature with no allow-pattern argument must fail loudly."""
        def sdk_unusable(model_id=None, token=None):
            raise AssertionError("must not be called")

        with self.assertRaises(TypeError):
            self._call(sdk_unusable)
        self.assertEqual(self.recorder.calls, [])

    # -- fail-fast behaviour required by Mission 2 -----------------------

    def test_type_error_fails_fast_after_one_attempt(self):
        """Run #6 must never be retried 360 times again."""
        attempts = []

        def sdk_raising_type_error(model_id=None, allow_file_pattern=None,
                                   max_workers=None, token=None):
            attempts.append(model_id)
            raise TypeError("snapshot_download() got an unexpected keyword argument 'endpoint'")

        with self.assertRaises(TypeError):
            self._call(sdk_raising_type_error, max_attempts=3)
        self.assertEqual(len(attempts), 1)
        self.assertEqual(self.sleeps, [])

    def test_value_error_fails_fast_after_one_attempt(self):
        attempts = []

        def sdk_raising_value_error(model_id=None, allow_file_pattern=None,
                                    max_workers=None, token=None):
            attempts.append(model_id)
            raise ValueError("invalid pattern")

        with self.assertRaises(ValueError):
            self._call(sdk_raising_value_error, max_attempts=3)
        self.assertEqual(len(attempts), 1)

    def test_transient_network_error_is_capped_at_three_attempts(self):
        attempts = []

        def sdk_timeout(model_id=None, allow_file_pattern=None,
                        max_workers=None, token=None):
            attempts.append(model_id)
            raise TimeoutError("read timed out")

        with self.assertRaises(TimeoutError):
            self._call(sdk_timeout, max_attempts=3)
        self.assertEqual(len(attempts), 3)

    def test_non_transient_runtime_error_is_not_retried(self):
        attempts = []

        def sdk_other(model_id=None, allow_file_pattern=None,
                      max_workers=None, token=None):
            attempts.append(model_id)
            raise RuntimeError("boom")

        with self.assertRaises(RuntimeError):
            self._call(sdk_other, max_attempts=3)
        self.assertEqual(len(attempts), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
