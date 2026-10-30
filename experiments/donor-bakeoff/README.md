# Isolated donor bake-off for Sham v2

This directory is a **separate experiment only**. It does not replace any production weights and does not import Sham v1, Nova, or the Sham v2 production application.

## Candidates

1. Qwen3.5-9B low-refusal community GGUF, Q4_K_M.
2. Gemma 4 E4B low-refusal community GGUF, Q4_K_M.
3. MiniCPM-o 4.5 official GGUF, Q4_K_M, for cross-family comparison.

Each candidate is assigned its own private ModelScope Studio with the prefix `sham-donor-*-test`. The workflow creates/updates only those experiment Studio repositories and never reads or changes `SHAM_V2_URL`, `SHAM_MODELSCOPE_URL`, `SHAM_MS_MODEL`, current Sham, or Nova settings.

The studio downloads its public GGUF from Hugging Face and runs CPU-only llama.cpp inference. Tests measure load time, Arabic output, Python coding, benign-request over-refusal, and model-generated GitHub/Vercel tool-call structure. **No connector credential is available in these studios and no GitHub/Vercel operation is executed.** A real connector integration test must be run only against the app's existing connectors in a separate permission-scoped test.

These are chat / multimodal-understanding candidates, not image/video diffusion generators. The first bake-off therefore does not claim to fix image or video generation. Those pipelines must be evaluated independently and connected to the winning text donor only after their API and token compatibility is clear.

## Expected ModelScope Studio names

- `novaai2026/sham-donor-qwen35-9b-test`
- `novaai2026/sham-donor-gemma4-e4b-test`
- `novaai2026/sham-donor-minicpmo45-test`

Workflow: `.github/workflows/donor-bakeoff-modelscope.yml`.


## Direct owner chat from the Nova Mini App

The owner-only model switch has a separate candidate-test section. Selecting one candidate sends Mini App messages directly to that candidate's own private Studio chat endpoint, with separate persisted conversation history for each candidate. It does not change the selected production model, invoke the Nova agent, enter Sham v1/v2 routing, or fall back to another Studio.

The candidate chat endpoint supports native user/assistant history and exposes proposed GitHub/Vercel function-call JSON for inspection. These tool schemas are not executed and no GitHub/Vercel credentials are sent to the candidate Studios. This first pass is text chat plus tool-call-shape inspection; image, audio, and video input/output are not wired in this round, including for MiniCPM-o 4.5.
