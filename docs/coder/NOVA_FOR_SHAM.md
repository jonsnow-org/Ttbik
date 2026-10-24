# Nova ↔ Sham: how each can help the other (2026-10-24)

Facts this rests on (read from the code and the logs, not assumed):
- Sham is a from-scratch multimodal model trained on free CPU/GPU (Kaggle notebooks, GitHub CPU trainer, Lightning). Its merge gate scores text / chat / media by loss (last run: text 4.49, chat 2.56, media 7.70). It has no tool calling; its Studio exposes `chat_auto`, `generate_any`, `think` (the model itself decides reply / search / picture / sound / clip).
- Nova is Qwen3.5-4B on llama.cpp (Studio, 2 vCPU). It runs agents (`delegate`), tools, long tasks, and it can be asked for a strong model (owner only).
- Loss numbers say "is it learning"; nothing yet says "is it getting more useful". That is what Nova can supply.

## Ideas, in the order I would build them

1. **Nova judges Sham (built: `nova-sham-judge.yml`, `scripts/nova-eval/sham_judge.py`).** 24 fixed Arabic prompts (chat, knowledge, maths, instructions, code, safety, Arabic grammar); Sham answers through its own Studio (read-only), Nova grades fluency / relevance / correctness 0–10. Same prompts every run → a readable trend next to the loss. Free (GitHub runner), one manual dispatch. Also available live: owner-only `delegate` role `sham`.
2. **Errors become lessons.** The merge/trainer logs already name the examples Sham fails worst. Nova writes a short correct Arabic answer (with the reasoning) for each, as new SFT rows. Targeted data instead of more of the same web text. (Sham notes #9 already imagined a "self-teacher driven by errors"; Nova is that teacher.)
3. **Rejection sampling.** Sham answers each prompt 4 times; Nova keeps the best (and the best-vs-worst pair for preference tuning). Costs only Sham's free inference; no external teacher.
4. **Teacher-written data, at a small steady rate.** Nova (our 4B on GitHub runners, ~8 tok/s per runner, matrix of parallel jobs) writes Arabic instruction→answer pairs from seed topics; filters (language, length, repetition, self-check) before they reach the SFT shard. Quality is that of a 4B model: good for form and format, weaker for facts, so facts come from the retrieved sources, not from Nova's memory.
5. **The owner's real Nova conversations (opt-in, owner only).** Finished successful runs, secrets/IDs redacted, exported as chat SFT rows (including tool-use traces, which Sham will need before it can be an agent). Never other users' conversations.
6. **Tool-use curriculum.** Before Sham can be a sub-agent worker it must learn the tool-call format; Nova generates and verifies synthetic tool episodes against our tool schemas (the Nova eval harness already grades them).

## Sham's training machinery that Nova can use
- The restarter already shares the Kaggle account between Sham and **Nova 1** (one Sham GPU session a week, Nova 1 the rest). Nova 1 is the LoRA fine-tune of Nova's own model.
- The **merge gate** idea (candidate accepted only if no skill gets worse) fits Nova LoRA checkpoints unchanged: gate on our tool/code eval (`scripts/nova-eval`) instead of loss.
- The dataset publishing and de-duplication tooling for shards can carry Nova's fine-tune data.

## What Sham cannot do yet (so it is not offered)
Tool-calling agents: Sham's text loss is ~4.5, it has no tool format; a Sham agent loop would fail at the first call. Sham is therefore used as a **worker that answers a plain question** (owner-only `delegate` role `sham`) and as a patient of the judge, not as an agent brain.


## Built on 2026-10-24 (owner asked for the engine's innovations to reach Sham)
- **Sham (advanced)** (`sham_loop`, owner only, in the one model picker): Sham answers INSIDE Nova's engine, so it gets what the engine gives any model: the research fast path (the engine runs one deep research and hands Sham a short excerpt as SOURCES), retry/patience on outages, resume after a server swap, step tracking in the terminal and the app. Sham gets no Nova system prompt and no tool schemas (it has no tool calling): the engine does the searching and the bookkeeping. The old "Sham" entry (legacy path, exactly as before) stays for testing training progress.
- **Lessons** (`coderLessons.ts`): every finished, successful run of the OWNER is kept as one clean example (research with its sources, tool use with results, chat) in `coder_lessons`. Secret-looking text drops the whole run; the system prompt is never kept; owner only; `CODER_LESSONS=off` stops it. Owner op `lessons` (counts; `export:true` returns JSON Lines; `clear:true` empties). Nothing leaves the database by itself.
- Not done, needs the owner's decision: where lessons are published for Sham's trainer (a private Kaggle/HF dataset in the format above) — it uploads her conversations to a third party.
