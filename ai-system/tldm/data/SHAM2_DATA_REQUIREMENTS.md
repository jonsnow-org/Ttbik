> Carried over unchanged from the closed draft PR #1136 (author: the other session), 2026-11-21, because the contract it states for the missing `tools` and `arabic` stages is useful and independent of that branch's code.

# Sham 2 training-data requirements (review contract)

This file distinguishes what is already in the repository from what is still missing. The minimums below are **admission floors**, not a claim that the resulting model will be high quality or that a dataset has passed a quality gate.

## Available fixed data today

The exporter creates only these supervised stages:

- `identity`: 16 fixed owner-approved identity pairs from `identity.py:TRAIN`.
- `terminal`: 30 fixed prompt-to-shell-command pairs from `terminal_tasks.py:TRAIN`. This teaches a narrow mapping from a natural-language request to a shell command. It does **not** contain a live tool-call protocol, the actual stdout/stderr from each execution, approval state, or assistant follow-up. It is not the `tools` stage.

Real source examples currently present:

```json
{"prompt":"من أنت؟","target":"أنا شام برو، مساعد ذكاء اصطناعي صنعه فريق مالك مشروع شام.","stage":"identity"}
{"prompt":"اعرض الملفات","target":"ls","stage":"terminal"}
```

The exporter does not execute commands or produce new answers. The 12 terminal held-out pairs and 14 frozen rewording held-out pairs remain evaluation-only. Identity held-out entries remain prompts-only because the source has no answer keys.

## tools — currently missing

**Yes: the stage requires real tool execution examples with observed outputs.** A list of tool names, JSON schemas, canned outputs, static command mappings, generated traces, mocks, or prompt-only examples do not qualify.

Admission floor:

- At least **1,000 training decision records** from real tool executions.
- At least **100 separate held-out decision records**, split by trace/session before training.
- At least **20 training records for every tool that is enabled for Sham**; the overall 1,000-record floor still applies.
- Each source trace must preserve a stable trace/session ID, actual tool name, exact arguments, approval/consent outcome, execution status, real result (stdout/stderr or structured result), and the subsequent assistant action/final answer.
- No synthetic trace generation, template expansion, mocked output, inferred output, or fabricated approval/results.

Required JSONL shape (the following is a **schema template only**, not an existing real record and must not be added to training as-is):

```json
{"prompt":"<serialized conversation ending at the model decision>","target":"<the exact next assistant tool call or assistant response>","stage":"tools","trace_id":"<real immutable trace id>","tool_name":"computer_run","tool_arguments":{"command":"<actual approved command>"},"tool_result":{"exit_code":0,"stdout":"<actual captured stdout>","stderr":"<actual captured stderr>"},"approval":"approved","source":"<live execution-log source>","source_revision":"<immutable source revision>"}
```

One record corresponds to one model decision. The call record's target is the actual tool call. After execution, the next record's prompt must include the observed tool result and its target must be the model's actual next call or final answer. The tool result is evidence/metadata in the trace; the model must not be trained to invent tool output as though it executed the tool itself.

**No qualifying real tool-trace example is present in the current repository**, so this PR does not invent one.

## arabic — currently missing

A fixed local JSONL snapshot from **CIDAR or Aya** is the intended source. Yes: it must be downloaded once, pinned to an immutable dataset revision/config, checked for license and provenance, stored as a fixed file, hashed, and consumed offline by the trainer. No dataset fetch/streaming is allowed during training.

Admission floor:

- At least **10,000 training records**.
- At least **1,000 separate held-out records**, split before training and excluded from all train/rewording generation.
- At least **90% of target text records must be Arabic**, with mixed-language rows explicitly language-tagged and counted.
- Every record must carry source dataset, configuration, immutable revision/commit, source record ID, and split; the manifest must contain the JSONL SHA-256 and exact row counts.

Required training line shape (the following is a **schema template only**, not an existing CIDAR/Aya record):

```json
{"prompt":"<real preceding Arabic context or actual instruction>","target":"<the real next Arabic text span or source answer>","stage":"arabic","source_dataset":"Aya","source_config":"<dataset config>","source_revision":"<immutable revision>","source_record_id":"<source row id>","split":"train","language":"ar"}
```

For plain-text corpora, `prompt` and `target` must be adjacent spans from the same original text, not newly authored question/answer pairs. For instruction corpora, keep the original instruction/context and its original response. Do not translate, paraphrase, or invent labels to fill gaps.

**No fixed, local CIDAR/Aya sample currently exists in this repository**, so this PR does not claim an Arabic example or download a dataset.

## CLI semantics

- `--stage available` means exactly `identity,terminal`.
- `--stage identity,terminal` selects the same two available stages.
- `--stage all` means `identity,tools,arabic,terminal` and must fail before the donor download while `tools` or `arabic` is missing.
- Any partial run is labelled `partial, not full` in the exported manifest and training report. It never aliases to `all`.
- `--check-donor` downloads only `final_merged.pt`, reports tensor names/shapes/dtypes, compares the embedded configuration/state dictionary with the repository's canonical `checkpoint.load_checkpoint` / `ShamSmall` layout, and returns `compatible`, `incompatible`, or `not_checked` (download/access failure). It does not download the tokenizer, train, serve, or run a gate.
