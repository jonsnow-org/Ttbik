# Sham v2 media serving setup

This change intentionally does not touch training or notebook code.

## Required one-time setup

1. In GitHub Actions, run **Sham v2 media weights (ready picture model + Arabic voice into Sham's own model repo)** (`sham-v2-media-weights.yml`). It copies the pretrained SDXS image model and Piper Arabic voice into `novaai2026/sham-v2/media/`. The Studio does not treat the Sham token decoder as a substitute for a real image diffusion model.
2. Create or verify a Hugging Face Space with **Gradio SDK** and **ZeroGPU** hardware. The existing `.github/workflows/deploy-hf-video-space.yml` deploys `ai-system/huggingface-video/app.py`, which runs LTX-Video. It cannot create the Space itself.
3. Configure these environment variables in the **Sham v2 ModelScope Studio**:
   - `HF_VIDEO_SPACE_ID`: exact Hugging Face Space ID, `owner/space-name`.
   - `HF_TOKEN`: a Hugging Face token that can access the Space.
   - Keep `MODELSCOPE_API_TOKEN` configured for the private Sham v2 model repository.
4. Deploy the updated ModelScope app and restart/redeploy the Studio. Then inspect its `status` API: `video_backend.configured` should be `true`, and `media_root_available` should be `true` once the image/voice weights are present.

## Honest capability boundaries

- **Image:** pretrained SDXS diffusion weights, one-step inference.
- **Speech:** pretrained Piper ONNX voice.
- **Video:** LTX-Video temporal video diffusion on the separate Hugging Face ZeroGPU Space. Sham does not fall back to a repeated still/slideshow when this service is unavailable.
- The existing text model is not retrained by this change. Text reasoning quality remains dependent on the checkpoint that is already deployed.
- A code change cannot create the Hugging Face Space, grant GPU quota, or inject private tokens. Those are external account/deployment prerequisites and must be confirmed with a live generation after setup.

## Standalone FastAPI/Streamlit deployment

For the separate standalone backend used by the Streamlit UI, set `SHAM_MEDIA_ROOT` to the directory containing `sdxs/` and `piper/`. Set `HF_VIDEO_SPACE_ID` and `HF_TOKEN` in that backend's environment for real LTX-Video generation. Its `/generate/image`, `/generate/audio`, and `/generate/video` endpoints now return HTTP 503 with an explicit reason if the real backend is unavailable; they do not emit Sham token-decoder noise or a slideshow as if it were a successful result.
