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

- The Telegram bot accepts photos, voice/audio files, and video attachments. The selected candidate's loaded projector determines which modalities can be processed; unsupported modalities return an explicit error instead of falling back to another model.
- The automated media smoke checks use deterministic fixtures: red/blue/yellow plus the number 42 in an image, a pure 440 Hz tone without speech, and a yellow square moving from left to right in a short video.
- These are narrow semantic smoke assertions, not a general multimodal benchmark or quality certification. Human review of every candidate's actual answers remains necessary.
- This round tests multimodal **input/understanding** from the Telegram chat. It does not add image generation, video generation, speech synthesis, or full-duplex audio output. MiniCPM-o's separate speech/TTS weight files are not loaded by this runtime.

The main weight and projector are downloaded independently. The deployment wait can therefore be longer the first time each Studio receives a projector; retries reuse the existing private Studio and cached downloads whenever possible.

## Evaluation

Every smoke test is a separate Gradio event. This avoids the previous five-test callback timing out as one long event and losing its poll result. The workflow collects:
- Arabic answer quality (review the actual response, not only the Arabic-character heuristic).
- Python code and benign read-only task completion.
- Benign-request over-refusal heuristic.
- The full tool loop: model-selected function call, allowlist validation, actual read-only execution, result hand-back to the model, and final answer.
- A multi-stage source-analysis task: repository scan, reading actual `package.json` and `src/lib/donorTests.ts` contents, then the public-site HTTP probe. The final answer must contain identifiers found in the actual files, not merely a claim that tools were called.

The isolated Studio can execute three allowlisted public read-only checks: `github_repo_scan` lists the root of a public GitHub repository; `github_read_files` reads up to three UTF-8 text files from a public GitHub repository and can return focused line excerpts; `vercel_deployment_status` reads the actual Vercel status context attached to the latest GitHub commit, avoiding the blocked public-site network probe. This reports the Vercel GitHub deployment check, not arbitrary Vercel control-plane settings. The Studio has no private GitHub/Vercel credentials and no write-capable operations.

The long-task benchmark uses the candidate's configured context window (Gemma 4 E4B: 4,096 tokens in this test), not the model's advertised maximum context. It measures one bounded task only; it is not evidence of multi-hour persistence or unlimited context.

The reports are uploaded as GitHub Actions artifacts for the donor workflow. A candidate is not declared a winner automatically; compare response quality, media understanding, code correctness, tool-call reliability, latency and memory use before deciding whether to continue training Sham v2 from its weights.

## Direct owner testing inside the Telegram bot

The candidate selector in the owner's Mini App only chooses which isolated candidate is active. It does not show a second chat window and does not link out to ModelScope. Messages are sent in the existing Telegram bot conversation.

- Use `/models` in the Telegram bot to choose Qwen3.5-9B, Gemma 4 E4B, MiniCPM-o 4.5, or exit candidate mode. The Mini App model popover also persists the owner-only candidate selection.
- After selection, each incoming Telegram text message or supported photo/audio/video attachment is routed straight to that candidate Studio. The selected donor route is checked before Nova/Sham routing and also works when Nova's coding Studio is disabled.
- The route has a per-candidate conversation history and task slot. If the candidate is not ready, an upload fails, or inference errors, the bot shows the error and does not send the message to Nova, Sham v1, Sham v2, or another candidate.
- Telegram photos, voice/audio files and video attachments are passed as bounded base64 payloads to the selected Studio's private chat_payload endpoint. No public media URL or external generation service is used.
- The ModelScope Gradio UI is an implementation surface only; users are not asked to open it to chat. ModelScope links are not shown in the Mini App.
- The candidate's three allowlisted public read-only tools execute inside the isolated Studio, and the bot can display the execution audit, including files actually read. They do not use production connector credentials or permit writes.
- The current benchmark runtime reports model-native output capability separately from runtime generation capability. It does not implement image, audio, or video generation, and it never substitutes an external generator.

The owner can switch out of donor mode using `/models` → “return to normal model”, or by choosing a regular production model in the Mini App. Choosing a regular production model clears the active donor selection but does not alter any production weights.
