# Isolated image-generation candidate bake-off

This is a private image-generation experiment. Every Studio runs one candidate only. It does not replace or modify Nova, old Sham, Sham v2, or the language-model donor-bakeoff Studios.

## Candidates

- Umranz — Umranz/SD1.5-Uncensored-Photoreal
  - Stable Diffusion 1.5 Diffusers checkpoint, roughly 2.13 GB of model files.
  - CPU FP32; default 512x768, 30 steps, CFG 6.5.
- CyberRealistic FINAL FP16 — existing isolated Studio novaai2026/cyberrealistic-final-test
  - Existing checkpoint package and SHA-256 verification are retained. The image test bot adapter talks to this Studio without redeploying it.
  - Default 512x768, 30 steps, CFG 5.
- Juggernaut XL Ragnarok FP8 — Kandoo/Juggernaut-XL-Ragnarok
  - Loads the creator's FP8 E4M3FN single-file checkpoint.
  - CPU FP16 runtime; the deployment workflow requires a free CPU Studio with at least 16 GB RAM. It will not select a paid flavor or pretend an 8 GB Studio is sufficient.
  - Default 768x1024, 30 steps, CFG 5.

## Bot test

The owner-only /models menu exposes a separate image-generation selector. Once an image candidate is selected, each text prompt is sent only to that candidate's private Studio. A failure is reported directly; the request is never redirected to Nova, Sham, Sham v2, or another image candidate.

The CyberRealistic Studio is already separate and is not restarted by this experiment. Umranz and Juggernaut receive new private ModelScope Studios.

## Safety and scope

This is not an unrestricted public image service. It is a private owner-only evaluation route with narrow safeguards against sexual depictions of minors and non-consensual intimate imagery of real people. Those limits are not removed. Do not use real-person likenesses for intimate or degrading imagery.

## Evaluation

The workflow smoke-tests Umranz and Juggernaut with a benign photorealistic scene, records image dimensions, runtime and SHA-256, and uploads the samples as a GitHub Actions artifact. The bot can then be used for the broader human comparison. A completed smoke test confirms transport and a non-blank image; it does not establish image quality.
