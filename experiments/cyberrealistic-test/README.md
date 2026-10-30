# CyberRealistic FINAL — separate photo-generation candidate

This is a dedicated checkpoint experiment and does not share weights with Realistic Vision V6.0 or any language-model candidate.

- Official source: https://huggingface.co/cyberdelia/CyberRealistic
- Creator notes and official SHA-256: https://cyberdelia.nl/models/cyberrealistic-sd-1-5
- Exact staged file: `CyberRealistic_FINAL_FP16.safetensors`
- Architecture: Stable Diffusion 1.5
- VAE: baked into this checkpoint; do not attach Realistic Vision's MSE VAE or another external VAE
- Expected official SHA-256: `2209c07b331a06cb28cf7c830ec758ae5b49eb97fab21f5de6b18c7be8b41554`
- License: CreativeML OpenRAIL-M

Creator guidance: DPM++ SDE Karras or DPM++ 2M Karras, 30 steps, CFG 5, 512×768. The dedicated test app starts with these values.

The uploader refuses to publish the file if its SHA-256 differs from the creator-published hash. The Studio is private and CPU-only; production media routes are not changed.
