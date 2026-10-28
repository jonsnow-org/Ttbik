# Modes, thinking and speed (Nova, Sham, Sham v2)

One system for every model: `src/lib/modes.ts` (profile), `src/lib/modeForce.ts` (owner override). Nothing in it lowers Nova's intelligence: it decides **when** a thought is spent, and removes latency elsewhere.

## 1. Three things, kept apart

| Setting | Values | Where | What it does |
|---|---|---|---|
| Mode (accuracy) | fast / balanced / precise | per model, Mini App → settings | sampling temperature, answer cap of plain chat, thought-length cap, correction rounds |
| Auto | on (default) / off | per model | on: the mode actually used follows the request class (a greeting is always fast; code / GitHub work is never below balanced) |
| Thinking policy | adaptive (default) / always / never | per model | when the model thinks (below) |

The owner can force one mode for every user of a model (Mini App → settings → "Force a mode"); it is stored in `coder_flags` and cached 20 s.

## 2. Request classes (`classifyRequest`)
trivial (greeting / thanks / who are you) · chat · code · agentic (GitHub, run / install / test, several steps, long text) · media.

## 3. Thinking policy by stage of the task
* **plan** = the first model step of a task (reads the request, chooses the tools). **act** = later tool steps. A loop recovery (stall level 2) always thinks.
* **adaptive** (default): Nova thinks at *plan* for code and agentic work; does not think at *act* steps (the plan already exists; each thought costs 25-60 s on the Studio CPU); never for greetings or media.
* **always**: thinks at every step of every request except greetings and media (the old "deeper thinking" switch maps here).
* **never**: no thought at all.
* Sham v2: see §5 — adaptive never thinks there. Sham (old) cannot think.

## 4. Where latency is cut WITHOUT touching thinking
1. Greetings only get a short system text, no tool block (Nova: ~10 s → ~4.7-5 s; the Studio prefix cache survives the switch back: the next full-prompt call re-read 15 tokens, not 9.8k).
2. A plain knowledge question in *fast* mode (`isPlainQuestion`, no fresh-facts words) uses the chat system text without tools. A terse command ("عدّل", "كمل") never does: it continues a task and keeps every tool.
3. Plain chat has an answer cap per mode (450 / 900 / 1600 tokens); code and tool steps are never capped (a cut tool call is a failed call).
4. One fixed tool list at every step, so the Studio's prompt cache is reused.

## 5. Does Sham v2 have modes / thinking of its own?
Checked in `ai-system/colab/sham_small/sham_v2_train.py` and `ai-system/modelscope-sham/app.py`: Sham v2 was fine-tuned only on answers whose thought block is EMPTY (`<think></think>`); there is no special thinking token and no mode token in the tokenizer or the chat template. So **Sham v2 has no trained modes and no trained thinking**. What exists is generation / prompt level only, honestly labelled: temperature, the length of the answer, an optional "thought" block asked from the Qwen3-format donor (untrained, experimental: only on `always`, only for code / agentic work). `fast / balanced / precise` for Sham v2 are therefore sampling and length presets, not different brains.

## 6. Measured (GitHub Actions CPU runner, `modes-bench.yml`; the Studio CPU is slower in absolute terms, the ratios are what matters)

Nova (Qwen3.5-4B Q4_K_M, 2 threads):

| Case | Time | Quality |
|---|---|---|
| cold read of system + 62 tools (9.8k tokens), once | 293 s | (the cost of the full prompt; cached afterwards) |
| greeting, full prompt | 10.3 s | ok |
| greeting, lite | 4.7-5.8 s | ok |
| code ("write a Python function"), full tools, think OFF | 27 s | **wrong**: called `make_media` instead of writing code |
| same, think ON (plan stage) | 87-138 s | **correct** code |
| same, lite no tools, think OFF | 23-34 s | correct code, but no tools for the next step |
| GitHub step 1, think OFF / ON | 23 s / 35 s | ON picks the right tool with its reason |

Reading: thinking is what prevents the tool misfire, so adaptive KEEPS it at the plan stage; the saving comes from not thinking at act steps, on greetings, on media, and from the lite greeting path.

Sham v2 (Qwen3-format donor + Arabic SFT):
* bare prompt (no tool block): greetings 8-16 s vs similar with the block (small gain), but code answers got worse (broken / truncated). So only a greeting drops the tool block.
* code cut at ~96 tokens: a Studio-side cap (`SHAM_GENERATE_ANY_MAX_TOKENS`). Default raised to 320 (400 for `MAX_NEW_TOKENS`) for `sham-v2` in `ai-system/modelscope-sham/app.py`. **Needs a Studio redeploy.**

Sham v2 images (SDXS, 1 step, CPU, per picture):

| side | 1 step | 2 steps | 3 steps |
|---|---|---|---|
| 512 | 1.8 s good | 3.1 s noisy | 4.3 s noisy |
| 640 | 2.7 s good, more detail | 4.5 s noisy | 6.5 s noisy |
| 768 | 3.8-4.0 s subject repeated / small | 6.7 s noisy | 9.4 s noisy |

SDXS is a one-step distilled model: more steps ruin the picture. The accuracy gain is therefore the side: Sham v2 now generates at **640** (env `SHAM_IMAGE_SIDE`, `sham_media_ready.py`), +0.9 s. Steps stay 1.

## 7. Tests
`src/lib/__tests__/modes.test.ts`: classification, effective mode, thinking by policy and stage, lite paths, the real Nova loop (what is sent to the Studio: think flag, tools, max_tokens), the real Sham agent call header, owner override.
