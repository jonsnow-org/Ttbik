# Gemma 4 — independent Realistic Vision V6 image-weight Studio

This is a dedicated private image-generation weight set for the Gemma 4 candidate.
It has its own private ModelScope model repository and its own private ModelScope
Studio. It is intentionally duplicated from the already verified source checkpoint:
the exact same checkpoint hash is staged independently so this route does not share
Qwen's CyberRealistic Studio, MiniCPM's Umranz Studio, or Sham v2's existing RV6 Studio.

- Candidate model: Gemma 4 E4B
- Source checkpoint: SG161222/Realistic_Vision_V6.0_B1_noVAE
- Dedicated private model repository: novaai2026/gemma4-realistic-vision-v6-test-models
- Dedicated private image Studio: novaai2026/gemma4-realistic-vision-v6-test
- API: https://studio-novaai2026-gemma4-realistic-vision-v6-test.api-inference.modelscope.net
- The checkpoint and MSE VAE are verified by SHA-256 before loading.
- The CPU image endpoint returns both the PNG and model/hash metadata.
- This Studio is not used by Nova or Sham v2.

This is a second deployment of a previously successful checkpoint, so the smoke test
confirms that the new Gemma-only copy and endpoint are healthy; it does not invalidate
or overwrite the previously saved RV6 sample.
