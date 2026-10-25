# What Nova learned about slow reads (for the Sham AI session; measured on CPU llama.cpp Studios)
Applies to any llama.cpp server running on a small CPU with prompt caching. Nothing here edits Sham files; take what fits.
1. The prompt cache is a PREFIX cache: anything that changes near the START of the prompt (date, notes, memories, tool list, accuracy line) forces a full re-read. Put changing text in the LAST user message. Measured: a changed tool list = cache 0, 109 s re-read; only the last message changed = ~3 s.
2. Keep the tool list byte-identical between steps (fixed order, groups only grow, never shrink).
3. Cap the history window and only move its START forward in one jump (to a small window), never a little every step.
4. "Thinking" ON cost 134+ s vs 23 s for the same step with it OFF; cap the thought length and, if a thought ends with no text and no tool call, ask again with thinking OFF.
5. Route a conversation back to the server that holds its cache when it has at most one job ahead; do not redeploy servers while the owner is testing.
6. Independent read-only tool calls of one step can run together; composite read tools save whole model steps.
7. Speculative decoding without a draft model (`--spec-type ngram-simple`) is only an opt-in experiment: measure on one server first, fall back automatically if the server does not start.
8. Stream `return_progress` (prompt tokens processed / cached) so the UI shows real reading progress.
