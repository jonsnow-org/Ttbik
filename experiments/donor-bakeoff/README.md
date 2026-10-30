# Isolated donor bake-off for Sham v2

This directory is a **separate experiment only**. It does not replace any production weights and does not import Sham v1, Nova, or the Sham v2 production application.

## Candidates and isolated Studios

1. Qwen3.5-9B community Q4_K_M checkpoint.
2. Gemma 4 E4B Heretic community Q4_K_M checkpoint.
3. MiniCPM-o 4.5 official Q4_K_M checkpoint.

Each candidate has its own private ModelScope Studio:

- \`novaai2026/sham-donor-qwen35-9b-test\`
- \`novaai2026/sham-donor-gemma4-e4b-test\`
- \`novaai2026/sham-donor-minicpmo45-test\`

The deployment workflow changes only these three explicitly named experiment Studios. It does not read or modify \`SHAM_V2_URL\`, \`SHAM_MODELSCOPE_URL\`, \`SHAM_MS_MODEL\`, current Sham, or Nova production settings. No other Studio is a target.

## Runtime

Each Studio downloads its own main GGUF and the candidate's compatible multimodal projector from Hugging Face, then starts a pinned \`llama-cpp-python 0.3.36\` MTMD API server bound only to \`127.0.0.1\`. Both the model and projector run CPU-only (\`n_gpu_layers=0\`, maximum two worker threads in this experiment). The Gradio UI talks only to this local server.

Images, audio, and video are sent as direct base64 payloads to the local model server. No external media API, remote URL fetch, or media-generation provider is used. The UI reports the actual capabilities detected from the loaded projector; a modality is marked unsupported when the runtime does not report it.

- Image, WAV/MP3 audio, and MP4/MOV video uploads can be tried in the private candidate Studio UI when supported by its detected projector.
- The built-in media smoke checks create small synthetic input fixtures and verify that the media ingestion plus model inference pipeline completes.
- A media smoke "pass" means the runtime accepted the media and produced a response; it is **not** a semantic accuracy score. Human review of the answer against the uploaded media is still needed.
- This first round tests multimodal **input/understanding**. It does not add image generation, video generation, speech synthesis, or full-duplex audio output. MiniCPM-o's separate audio/TTS weight files are not loaded by this first-round runtime.

The main weight and projector are downloaded independently. The deployment wait can therefore be longer the first time each Studio receives a projector; retries reuse the existing private Studio and cached downloads whenever possible.

## Evaluation

Every smoke test is a separate Gradio event. This avoids the previous five-test callback timing out as one long event and losing its poll result. The workflow collects:
- Arabic answer quality (review the actual response, not only the Arabic-character heuristic).
- Python code and benign read-only task completion.
- Benign-request over-refusal heuristic.
- Model-generated GitHub/Vercel tool-call structure and exact arguments.

GitHub and Vercel schemas are exposed only to see whether the model proposes a correct tool call. **No connector credential is available inside the Studio and no GitHub/Vercel API operation is executed.**

The reports are uploaded as GitHub Actions artifacts for the donor workflow. A candidate is not declared a winner automatically; compare response quality, media understanding, code correctness, tool-call reliability, latency and memory use before deciding whether to continue training Sham v2 from its weights.

## Direct owner chat from the Nova Mini App

The owner-only model switch retains a separate text-only chat path for each candidate and its own conversation history. Selecting a donor there does not change the selected production model, invoke the Nova agent, enter Sham v1/v2 routing, or fall back to another Studio. The Mini App path is not the media test UI; use the private ModelScope Studio UI for image/audio/video uploads.

