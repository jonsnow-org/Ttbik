# Realistic Vision V6.0 — isolated visual test

This experiment is intentionally separate from every production media path.

- ModelScope private model repo: `novaai2026/realistic-vision-v6-test-models`
- ModelScope private Studio: `novaai2026/realistic-vision-v6-test`
- Checkpoint: official creator repository `SG161222/Realistic_Vision_V6.0_B1_noVAE`, FP16 single-file artifact.
- VAE: creator-recommended `stabilityai/sd-vae-ft-mse-original`, MSE 840000 EMA safetensors artifact.
- Runtime: CPU-only, one generation at a time.
- Sampler: DPM++ SDE Karras, 25 steps by default.
- Image sizes initially limited to 512x512, 512x768 and 768x512 for CPU feasibility.

The upload step copies only:
1. one FP16 checkpoint,
2. one recommended VAE,
3. the tokenizer and small config files,
4. a manifest with SHA-256 hashes.

The upstream Diffusers component weights are deliberately not copied, because that would store a second multi-gigabyte copy of the same network. The Studio verifies both hashes before loading. Model loading is local from ModelScope; the Studio does not fetch from Hugging Face.

No Nova, Sham v2, old Sham, current SDXS, bot routing, Vercel production settings, or production ModelScope Studios are modified by this experiment.

A valid HTTP response or a non-blank-image check is not a quality verdict. Realistic faces, hands, anatomy, fine detail and text/logo rendering must be reviewed visually before any production route is considered.
