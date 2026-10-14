# ذاكرة تدمر — Palmyra Memory (2026-10-14)

Per-user memory for Sham **without any training loop**. Strictly additive: `model.py`, `generate.py`, the checkpoints and every existing Studio
endpoint (`chat_auto`, `generate_any`, `ask_web`, …) behave exactly as before. Only the new endpoint `chat_memory` uses it.

## Files
| file | role |
|---|---|
| `sham_memory.py` | SessionKV (attention cache per user on disk, fp16, weight fingerprint), EpisodicBank (over `sham_longctx.TokenBank`), FactKNN (kNN-LM over the user's facts, used only when the question is about that fact), fact rules, «انسَ معلوماتي», `memory_answer()`; later stage, OFF: `write_fact_candidate()` (ROME/MEMIT-style rank-1 write on a COPY → candidate for the gate), `StyleVector` |
| `sham_memory_eval.py` | measurement on a real checkpoint: recall after 3/10/30 turns, no-regression, isolation, forget, episodic, speed |
| `sham_chat.py` | `build_multiturn_example`, `_conversation_turns`, `load_arabic_conversations`, `conversation_examples` (labels only on Sham's turns) |
| `sham_live.py`, `kaggle_notebooks/sham_chat_stage.ipynb` | multi-turn conversations added to the TRAINING examples (on by default; `SHAM_CHAT_MULTITURN=0` = off); the held-out yardstick, the guard and the merge gate are unchanged |
| `sham_longctx_train.py` | `recall_budget()`, `train_max_len()`, `prepare_long_context()` — the 2048 option |
| `../../modelscope-sham/app.py` | endpoints `chat_memory(prompt, max_new_tokens, user_id, history, summary, facts)` and `memory_forget(user_id)` |
| site: `src/lib/shamMemory.ts`, `prisma/migration_19_sham_memory.sql` | Postgres sliding window (8 turns), rolling summary, user facts, forget |

## Environment
| variable | default | meaning |
|---|---|---|
| `SHAM_MEMORY` | `1` | `0` = `chat_memory` answers exactly like `chat_auto` (site: no database memory) |
| `SHAM_MEMORY_DIR` | Studio: `<app>/_memory`, else `/tmp/sham_memory` | one hashed directory per user |
| `SHAM_MEMORY_SALT` | `sham-palmyra` | salt of the user hash (set the same value on the site and Studio if changed) |
| `SHAM_MEMORY_WINDOW_TOKENS` | `900` | conversation tokens kept in context; older turns go to the episodic bank |
| `SHAM_MEMORY_KV` / `SHAM_MEMORY_EPISODIC` / `SHAM_MEMORY_KNN` | `1` | switch each layer |
| `SHAM_MEMORY_KNN_LAMBDA` / `SHAM_MEMORY_KNN_MIN_SIM` | `0.5` / `0.7` | kNN-LM mix weight / similarity gate |
| `SHAM_MEMORY_KEY_LAYER` | `14` | layer whose mean hidden state keys the episodic bank |
| `SHAM_MEMORY_TTL_HOURS` | `24` | cache files older than this are dropped (text memory stays until forgotten) |
| `SHAM_MEMORY_FACT_WRITE` | `0` | allow `write_fact_candidate` (never touches served weights; output must pass the gate) |
| `SHAM_MEMORY_STYLE` (+`_LAYER`, `_SCALE`) | `0` | per-user style vector |
| `SHAM_CHAT_MULTITURN` | `1` | multi-turn training examples in `sham_live` and the chat stage (`0` = off) |
| `SHAM_LONGCTX_BUDGET` / `SHAM_LONGCTX_MAXLEN` | `512` / `1024` | set `2048` for the long-context option (GPU) |

## Disable
Studio: `SHAM_MEMORY=0` (or the bot simply does not call `chat_memory`). Site: `SHAM_MEMORY=0` in Vercel env. Delete one user: «انسَ معلوماتي» in the
chat, or `memory_forget(user_id)`.

## Measured (step-61,555 checkpoint, 2 CPU threads)
Run: `python sham_memory_eval.py final_merged.pt sham_small_tokenizer.json out.json`. Fact recall (4 questions × 3, 10, 30 turns): 12/12 with full
memory vs 0/12 without memory or with history alone; log-prob of the true answer ≈ −2.8…−3.4 vs ≈ −21…−31. Empty memory = old single-turn scores
(−21.6169 vs −21.617). No cross-user leak, forget works, unrelated questions not hijacked. 30-turn message: 2.2–2.5 s without the cache, 1.2–1.6 s
with it (577 tokens reused, 12.4 MB per user). Honest limit: fact recall relies on the fact rules + kNN; free-form use of long history stays weak
until multi-turn training (SHAM_CHAT_MULTITURN) passes the gate.
