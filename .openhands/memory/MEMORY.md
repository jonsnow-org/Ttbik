# Project memory — Ttbik (Nova/Sham AI marketplace + Athar)

Repo `/workspace/project/Ttbik`. Production branch: `claude/free-services-marketplace-h6rwk2` (Vercel). `main` syncs from it; Oracle follows `main`. Tests live in `athar/` (Jest), run with `--config ../jest.media.config.js --rootDir ..` from `athar/`.

## Test/CI facts (expensive to rediscover)
- Full Jest suite: `cd athar && npx jest --config ../jest.media.config.js --rootDir ..` → 142 suites, ~1307 passed, 2 skipped, ~56 s. Plain `npx jest` at the repo root uses a transient npx babel and dies with a parse error — always run from `athar/`.
- Python media suites: `python3 -m pytest ai-system/colab/sham_small/test_sham_cpu_video.py ai-system/supervision/test_media_video_jobs.py ai-system/app/test_nova_media_studio.py -q` → 42 passed, 2 skipped.
- CI runs a fixed 33-suite subset (`sham-v2-regression-tests` job in `.github/workflows/ci.yml`) + python suites in `ai-system/supervision` + `experiments/donor-bakeoff` + `scripts/transplant` + `scripts/tests/*.test.mjs` + `coder-sandbox/runner.test.mjs`.
- `chatLists.test.ts` is flaky by design: threads created in the same instant get identical `updated_at`; the list query has no tiebreaker. Seed must `await setTimeout(5)` between `createThread` calls.
- `coderFakes.ts` needs the `INSERT INTO tg_seen_updates` stub — `claimTelegramUpdate` runs on every coder webhook and, without it, retries/same-instant updates are dropped (3 suites fail).
- Lint: `npx eslint src` → 0 errors, ~159 warnings (mostly `react-hooks/set-state-in-effect`, `next/no-img-element`, `react-hooks/purity`). Warnings do not fail CI. `npx tsc --noEmit -p tsconfig.json` is clean.

## Revision pins drift (recurring bug class)
Every ModelScope app has an `APP_REVISION` string that is asserted in deploy workflows, preflight scripts, docs and TS guards. When the app revision bumps, ALL of these must move together or deploy/status checks fail closed ("deploying" forever):
- Computer hub: `ai-system/modelscope-media/computer_studio_app.py` `APP_REVISION` (currently `computer-hub-16gb-2026-11-11-r9-mount-probe`) ↔ `.github/workflows/deploy-minicpmo-big.yml` (2 asserts) ↔ `scripts/ops/modelscope_computer_hub_preflight.py` ↔ `docs/MODELS_AND_COMPUTER.md`.
- Donor bakeoff: `experiments/donor-bakeoff/app.py` `APP_REVISION` (currently `donor-bakeoff-2026-11-05-r21`) ↔ `src/lib/donorTests.ts` `EXPECTED_DONOR_APP_REVISION` / `ACCEPTED_DONOR_APP_REVISIONS`.
- Other app revisions asserted in workflows: `epicrealism-image-test-2026-10-31-r1`, `juggernaut-ragnarok-cpu8g-2026-10-31-r2`, `umranz-image-test-2026-10-31-r3`.

## Architecture: models are independent
`docs/MODELS.md` is the registry. Each model (`coder`=Nova AI, `sham`, `sham_v2`, `lfm25`) has its OWN inference + media Studios and its own computer session (`<userId>:<model>`). No fallback to another model; unconfigured → honest error. Key files: `src/lib/coderModels.ts` (registry/access), `src/lib/openCoderStudio.ts` (`ENGINE_MODELS` = coder+lfm25 only), `src/lib/modelMedia.ts` (media routing), `src/lib/modes.ts` (modes/thinking), `src/lib/novaBotLogic.ts` + `src/lib/shamStudio.ts` (Sham paths).
- The 16 GB `nova-inference-server` is COMPUTER-ONLY: no model may serve inference/media there (`ownMediaBase` blanks any URL containing `nova-inference-server`).
- Computer desktop client/server coordinate contract: the Studio `frame` returns `width`/`height` = the REAL screen (1344×840), while the live SSE stream (`desktopLive`) sends a 0.75-scaled picture. Any click mapping MUST use the reported `width`/`height`, never the `<img>` natural size (`GraphicalDesktop.tsx` `screenRef`), or clicks land short while streaming.

## Mini App live streaming + computer console (2026-11-06, commits e5db001/ed9032b)
- Every model's answer streams in the Mini App chat via the durable SSE feed `/api/coder/stream?runId=…&after=…`; the interval poll is only the fallback. Helper `src/lib/liveEvents.ts` (`mergeTaskEvents` dedups by event id and returns the SAME array when nothing changed so React skips the render; `splitSseFrames`/`sseFrameData`/`lastEventId`). The stream's reconnect cursor must live in a ref — reading it from the polled state on each reconnect makes it lag and re-deliver.
- `chat_messages` returns `liveRun` (the open chat's running task). A Sham run is tagged with its thread at `taskStart` via `coderChats.shamOpenThreadId`, NOT from `coderSections`: `src/lib/__tests__/novaShamBoundary.test.ts` forbids every Nova module except `coderApp.ts`/`coderChats.ts` from importing `@/lib/sham*`. Route any cross-side need through those two.
  - Owner order (2026-11-06): nothing is drawn OVER the computer screen; the activity console sits OUTSIDE and BELOW the frame (`src/lib/computerHud.ts` condenses the feed to one line per event). The graphical desktop is touchable (`onTouchStart` = real left click at the mapped point). `chatBubbles.ts` merges consecutive streaming text events into one bubble so the view does not jump.
  - Two real bugs found by testing against the real SQL engine (commit `2f030fe` + touch fix): (1) `mergeTaskEvents`/`lastEventId` must tolerate a task row with NO `events` field — `listTasks` returns rows only, the `thread` op pairs them, and the stream can arrive first; (2) `onTouchStart` + the browser's synthetic `click` both fired `clickScreen`, so every tap clicked the desktop twice — guard with a ~700 ms `touchAt` ref.

## Workflow fragility bugs (found 2026-11-05, fixed in 7c9d0c6)
- **sparse-checkout must list every cross-directory import.** `scripts/promo/supervise.mjs` imports `../supervisors/run.mjs`; the `promo-supervisor` workflow's sparse-checkout listed only `scripts/promo/supervise.mjs`, so EVERY scheduled run died with `ERR_MODULE_NOT_FOUND`. Fix = add `scripts/supervisors/run.mjs`. Verify by replaying the sparse checkout locally (copy only the listed paths to a temp dir, then `import()` the entry).
- **ModelScope API intermittently answers HTTP 200 with an EMPTY body.** `json.load` then throws "Expecting value: line 1 column 1" and the deploy step fails. `deploy-minicpmo-big.yml` now retries the target-verify and stop-old-runtime lookups 5× and treats an unreadable answer as "unknown". Many other `deploy-*.yml` files share the unguarded pattern (lower risk).
- Scheduled workflows run only from the DEFAULT branch — for this repo that is `claude/free-services-marketplace-h6rwk2`, not `main`. So a fix to a scheduled job only takes effect once it is on the production branch.

## Modes / progress card (owner rule 2026-11-05)
`requiresProgressCard(text)` in `modes.ts`: card only for code/agentic/media or chat needing fresh facts. Ordinary chat opens NO card; the model's reply is first. `lite` rule: `klass === "trivial" || (klass === "chat" && !needsFreshFacts(text))`.

## Media video: gateway retry (owner order 2026-11-05, fixes `6a63250` + `e5ccddb`)
Every media Studio's VIDEO failed while image+speech passed — NOT a code regression: the ModelScope gateway edge is flaky for the long video path and both clients gave up too early. All models route video through `src/lib/novaMedia.ts` `gradioCall()`. Fix = add 500 to the transient submit retry set and retry a dropped connection (no job created yet) in `novaMedia.ts`, `mediaEngines.ts`, `photoWeightMedia.ts`, `donorTests.ts`, `browserComputer.ts`; the probe's `Studio.call()` retries a cut poll up to 8×. Diagnose live reds from the Actions job log (message names the stage, e.g. "job: HTTP 502 ... after 1 submit attempt(s)"). The avatar/photo client-compute feature (65fa7b8) was REVERTED in `cfd1bc3`.

## Nova/Sham v2 media video (fixed 2026-11-05, live)
Two stacked bugs killed every model's video: (1) a 4 s/32-frame pass OOM-killed the 8 GB Studio → cap passes to 2 s/16-frame on low memory (`CPU_VIDEO_MAX_PASS_S`); (2) ffmpeg `minterpolate` dropped tail frames (2.00 s → 1.81 s) so a 3-pass clip failed `duration_mismatch` → use `framerate=fps=` (exact duration). The encoder block must stay byte-identical in `ai-system/modelscope-media/app.py` and `ai-system/colab/sham_small/cpu_video.py`. One pass takes ~15-16 min.

## Sham v1 native media: VQ collapse + real motion video (fixed 2026-11-06, `ai-system/colab/sham_small/`)
- **VQ-VAE codebooks collapse** (image AND audio): `VectorQuantizer.__init__` seeds codes with `uniform_(-1/n, 1/n)`, so at step 0 every code sits within ~0.004 of the origin while encoder outputs sit ~1.0 away → every location snaps to the same code. Measured 12/256 codes used. Fix: `initialize_from_data()` (k-means seed) + `revive_dead_codes()`, wired into `train_vqvae` via `data_init=True, revive_every=16, usage_decay=0.995`. Result: 256/256 used AND lower recon-MSE. Do NOT revive every step (over-churns: usage up, recon worse). Regression pin: `test_sham_vq_and_video.py`.
- **Video is the model's OWN motion tokens** (`motion_tokenizer.py`), not stitched stills: a clip = one keyframe image span + a motion span of flow tokens inside `<VIDEO_START>…<VIDEO_END>`, decoded frame by frame (`video_tokenizer.encode_clip`, `sham_studio_media._video_result`/`_long_video_frames`). Verified: ffmpeg-decoded frames really move (mean |Δ| per frame 0.19–3.6) and `media_quality.check_mp4` PASSES. Default clip = 48 frames/8 fps = 6 s; `SHAM_VIDEO_FRAMES` caps at 2400 = exactly 5 min.
- **Studio wiring**: `serve.py` puts the motion tokenizer in `_state["motion_tokenizer"]`; `ai-system/modelscope-sham/app.py` `generate_any` MUST pass `motion_tokenizer=serve._state.get("motion_tokenizer")` or the Studio returns NO_VIDEO even with trained motion rows (this was the gap).
- Vocab/params: `TOTAL_VOCAB_SIZE=43284`, real torch param count **515,534,080** (515.5M); `verify_architecture.py` target literal must match. Reserved special ids: `sham_decoding.py` turn markers = `_base+13/+14`, `motion_tokenizer` = `_base+15/+16`, `sham_correct.REVISE` = `_base+17` (a new id MUST be checked against all three, or `import sham_correct` / the CI self-test breaks).
- **Motion-tokenizer training** (`train_motion_tokenizer.py`, new): k-means `initialize_from_data` + dead-code revival on `FlowVectorQuantizer`; `estimate_flow` is an integer block matcher so its real alphabet is ~16 vectors (NOT collapse) — pinned in `test_sham_vq_and_video.py`. Wired into `kaggle_notebooks/sham_video_tokenizer_track.ipynb` (19 cells) publishing `sham-motion-tokenizer-checkpoint` (registered in `CONTRACT.json`, writer `video_tokenizer`).
- **Cell-sync table (`sham_cell_updates.json`)**: `sham_cell_sync.py --build` reads git history; on the default SHALLOW clone it silently DESTROYS the table (→1 entry). Run `git fetch --unshallow` (≈4985 commits) BEFORE rebuilding. Current: 159 map entries.
- **Training on compressed data = QAT** (`sham_qat.py`, new; owner request 2026-11-06): fake-quantize Linear/Embedding weights with straight-through, keeps weight tying; measured 4-bit QAT beats post-training quantization by 11.3% and is 8× smaller. Wired into `train.py` as `TrainConfig.quant_bits` (0=off).
- Sham v1 self-tests: run ONE process at a time (parallel torch self-tests OOM the box). Full python CI suite: `PYTHONPATH=ai-system/colab/sham_small python -m unittest discover -s ai-system/colab/sham_small -p 'test_sham_*.py'` (73 tests, 1 skipped).
- **Self-supervision automation** (owner's standing instruction): OpenHands automation `11ca278a-5923-4e82-91b5-a8135e43f47a` runs daily 06:00 UTC (max timeout 1800 s) — runs the Sham suite + `sham_ci_check.py`, continues the next pending Sham step, keeps notebooks synced. Create automations via `POST {OPENHANDS_HOST}/api/automation/v1/preset/prompt` with `OPENHANDS_API_KEY`.

## Sham v2 token streaming (2026-11-06, `812102c1`)
Sham v2 chat is now token-by-token live, like every other model. Path: `generate.py::generate_tokens_iter` (shared
step loop; `generate_tokens` unchanged) → `sham_studio_chat.py::qwen3_chat_stream`/`studio_generate_stream` →
`modelscope-sham/app.py::v2/generate_chat_stream` (+ `_chat_params`) → `src/lib/shamStudio.ts::readShamSseDeltas`/
`shamGenerateChatStream` → `shamAgent.ts::onDelta` → `novaBotLogic.ts::taskEvent(runId,"text",…)`.
- Stream pieces must be passed through **verbatim** (no `.trim()`): trimming each delta joins two words.
- A Studio without the endpoint answers 404/405 → fall back to one-shot `shamGenerateChat` delivered as ONE piece.
- Never stream a typed `busy`/`error` reply as text.
- Test trap: `shamGenerateChatStream` runs through `shamVariant`/pool, whose background overflow `/status` check eats a
  mocked `fetch`. Set `SHAM_V2_OVERFLOW_URL=off` in the test.

## Pushing from this sandbox (updated 2026-11-06)
The injected `$GITHUB_TOKEN` is a **read-only GitHub App token** (`jonsnowx1r-lab`): `403 "Resource not accessible by
integration"` on every write. Reads are fine. To push, the owner supplies a fine-grained PAT (`github_pat_...`); it
authenticates as `jonsnow-org/Ttbik` with `permissions.push=true` and a plain
`git push "https://${PAT}@github.com/jonsnow-org/Ttbik.git" HEAD:refs/heads/<branch>` works (verified 2026-11-06,
`511f1c7c..58b3d6a0`). The production/default branch is `claude/free-services-marketplace-h6rwk2`, NOT `main` —
merging into `main` alone is only a Vercel preview; users see a change only once it is on that default branch.
**Push protection trap:** a push fails `GH013` if ANY commit in the pushed range contains a secret, even one already
removed from `HEAD`. `.openhands/memory/*.md` is tracked and has carried an expired `ghu_` OAuth token before; redact
it from the offending commits (git filter-branch tree-filter over the range) rather than only fixing HEAD.
ModelScope: neither a `sk-...` key nor a 64-hex string authenticates — `/v1/models` is public (200 even with a
garbage token) and `/v1/chat/completions` and the private Studios all answer 401 for both, so neither is a valid
ModelScope token. The real ModelScope token that drives the Studios is `MODELSCOPE_API_TOKEN` in the deployment env.

## Sham tool-signature parity (claimed 2026-11-13/14 AND 2026-11-16; code was ABSENT both times; ACTUALLY landed 2026-11-18)
The live engine `src/lib/shamExec.ts` is the tool-schema source of truth; `validateShamCall` (`src/lib/shamTools.ts`)
**refuses a call with an argument the tool does not declare** («المعامل … غير موجود») or an out-of-`enum` value
(«يقبل فقط»). Training mirrors it in `ai-system/colab/sham_small/sham_tools_data.py::TOOL_SPECS`; it had drifted
(`ask_user` taught a bogus `options`; `make_media` missed `seconds`; `github_read_file` missed `start_line/end_line`;
`http_request` arg ORDER `url, method` vs engine `method, url` and `method` wrongly required — the engine requires
`url` only; an example used `make_media kind:"speech"` — engine enum is image/audio/video). Names were guarded but
**arguments were not**. **Two prior sessions wrote this whole "landed" section into MEMORY.md without ever adding
the code** — `engine_tool_args` did not exist and the drift was live (found 2026-11-16 by checking the tree, and
again 2026-11-18). Now for real (2026-11-18): `engine_tool_args()` parses `shamExec.ts` (arg names in order +
required + inline enums; a JS-variable enum like `skill.name` = `AGENT_SKILL_NAMES` is left unresolved), and
`tool_arg_problems()` returns every disagreement (TOOL_SPECS arg/optional vs engine, plus a CATALOG/generated example
passing an undeclared arg or an out-of-enum value). Both the module self-test and
`test_sham_tools_data.py::test_training_arguments_match_the_live_engine_schema` assert it. **The JS parser must be
string-aware** (an apostrophe inside a `//` comment, e.g. "the repository's files", breaks a naive quote scanner and
silently parses 0 tools), and the inline-`enum` read must be bounded to its OWN property (a naive search after a key
reads the NEXT property's enum — `desktop.text` "accepting" `['up','down']`). **Lesson: a memory entry that says
"code landed" is not evidence — grep the tree before trusting it; two sessions in a row repeated the same false note.**
`sham_cell_sync.py --build` in a **shallow clone empties** `sham_cell_updates.json` (no history) — restore it
with `git checkout --` unless a notebook cell actually changed.

## Sham test collection trap (found 2026-11-11; the "converted" note was FALSE — really fixed 2026-11-18)
CI runs the Sham Python tests with `python -m unittest discover -s ai-system/colab/sham_small -p 'test_sham_*.py'`. A file written in **pytest style** (bare `def test_*` at module top, or the `tmp_path` fixture) imports without error but contributes **zero tests** — it is silently invisible. Five files (`test_sham_stream_qat`, `test_sham_live_wiring`, `test_sham_script_guard`, `test_sham_live_motion_video`, `test_sham_hot_modules`, 14 tests) had never run in CI. **A prior session wrote "converted to unittest.TestCase (all pass). `test_sham_test_style.py` now fails CI" into MEMORY.md, but neither the conversions nor the guard existed in the tree (checked 2026-11-18) — same false-note pattern as the tool-parity entry.** Really fixed 2026-11-18: all five converted to `unittest.TestCase`, and `test_sham_test_style.py` added — it imports each `test_sham_*.py` in its OWN subprocess and fails if any collects 0 tests (subprocess so the shared-interpreter global state — `sham_inputs` swapping trainers — cannot leak; see the POLLUTION trap below). **Rule: every `test_sham_*.py` must be unittest-style; a bare-function file is a silent CI hole.** Before believing a test count, confirm the file is actually collected — `python -m unittest <module>` alone, or run `test_sham_test_style`.

## Sham test POLLUTION trap: never `import sham_inputs` in a `test_sham_*.py` (2026-11-15)
`import sham_inputs` runs `install()`, which **globally swaps** `train_image_tokenizer.train_vqvae` /
`train_audio_tokenizer.train_vqvae` for `sham_vq.train_vqvae_revive` — a function with a *different* signature (no
`data_init`/`revive_every`/`usage_decay`/`revive_threshold`). Under `unittest discover` every test file shares one
interpreter, so importing `sham_inputs` at module top in a new test breaks any *sibling* test that imported the
original trainer directly: `test_sham_vq_and_video` failed with `train_vqvae_revive() got an unexpected keyword
argument 'data_init'` **only in the full-suite run**, and passed alone. The lab's own convention (docstring of
`test_sham_merge_coverage`) is that `sham_inputs` runs in its **own interpreter**. Rule: a `test_sham_*.py` must NOT
`import sham_inputs`; the model path works without it. If you need it, shell out to a subprocess like
`test_sham_merge_coverage` does.

## Sham Intelligence Lab ↔ Sham bridge (`sham_task_gate.py`, claimed 2026-11-15, 2026-11-16 AND 2026-11-17 — ABSENT all three times; STILL not landed as of 2026-11-18)
**Three prior sessions wrote a full "landed" description of this file into MEMORY.md; the file does not exist in the tree
(checked 2026-11-16, 2026-11-17 and again 2026-11-18 at both HEAD and origin). This is the single worst repeat of the
false-note pattern — treat every paragraph below as a SPEC of what was intended, not as evidence of code.**
`intelligence_lab/` is a standalone package (owner's PR #894): deterministic generators, AST verifier, a per-task
non-regression gate `gates.py::evaluate_gate` + `GatePolicy` (default `min_macro_improvement 0.005`,
`max_task_regression 0.02`, `max_ece 0.12`, `min_examples_per_task 100`), and `uncertainty.calibration_report`.
`sham_sil_bridge.py` **does** exist and is the **sole** sanctioned bridge (it puts `intelligence_lab/src` on `sys.path`
via `LAB_SRC` and owns `FROZEN_SEED = 20261112`). Accessors: `heldout_rows` / `heldout_examples` (lab `Example`
objects, verifier + spec + evidence kept) / `verify(ex, answer)` (checks a GENERATED answer against the example's own
verifier, `passed` may be None) / `calibration(confidences, correct)` (lab ECE/Brier) / `train_pairs` / `chat_source`.
**Intended design of the missing `sham_task_gate.py`** (to land next): `measure()` builds the report `evaluate_gate`
wants (per-task loss from `sham_eval.answer_loss`; accuracy from the model's OWN generated answer checked by
`sham_sil_bridge.verify`; confidence `exp(-answer loss)` for ECE/Brier) and restores the model's original train/eval
mode in a `finally`; `gate()` runs `evaluate_gate` over tasks that carry accuracy in BOTH reports (the human-reviewed
`uncertainty` set — verifier `labelled_decision` — is measured for loss but never auto-judged on accuracy);
`guard_measure()` / `guard_evaluate()` feed the frozen per-task yardstick into `sham_guard.Guard.evaluate(model, ema, measure)`.
Gotchas to honour when landing it: `evaluate_gate` does `candidate.get("calibration", {}).get("ece")`, so a report MUST
carry a calibration dict (not `None`); `GatePolicy` is `frozen=True` so rebuild it with `dataclasses.replace`; the frozen
set at `count_per_task=8` has 104 examples (smallest task 8) so `min_examples_per_task` must be `<=8` (`MIN_EXAMPLES=8`).
Owner rule honoured: nothing there may touch weights/checkpoints/the merge gate. When it IS landed it should be tested by
`test_sham_task_gate.py` (tiny random model) and run as `python sham_task_gate.py`.

## Sham v2 chat deploy readiness (fixed 2026-11-06, live) — NOT flaky
`Deploy the Sham v2 Studio` failed DETERMINISTICALLY: a redeploy leaves the PREVIOUS container answering `/status`, and the pre-2026-10-30 app reports `phase=ready` WITHOUT `context_tokens`. Gate on `context_tokens>=4096` (in `deploy-modelscope-sham-v2.yml` + `-overflow.yml`), never just `phase==ready`; ModelScope may print `no change` and not rebuild. Second trap: steps run under `bash -e`, so a failing grep inside `ctx=$(... | head -1)` aborted a deploy silently — append `|| true`. Regression test: `test_sham_v2_chat_smoke.py::test_deploy_waits_for_the_new_app_context_not_the_previous_container`.

## Sham v1/v2 video: two real root causes (fixed 2026-11-07, commit 8388d44e)
- **Training/inference layout mismatch (v1).** `sham_live.py` trained video as N independent keyframes + audio (`build_video_chat_examples`, `VIDEO_KEYFRAMES=2`), but `sham_studio_media._video_result` generates and `video_tokenizer.decode_clip` decodes a keyframe PLUS motion (flow) tokens (`<VIDEO_START> IMAGE_START key IMAGE_END MOTION_START (frames-1)*vectors_per_frame MOTION_END VIDEO_END`). A checkpoint trained only on the old layout can never answer the Studio → `NO_VIDEO` notice or stitched stills. Fix: `sham_chat.build_motion_video_chat_examples` + `sham_live.Encoder` motion path (`motion_tok` param, `VIDEO_MOTION_FRAMES=8`) + carry `motion_tokenizer.pt` through the checkpoint (`save_motion_tokenizer`, publish list).
- **Motion grid/block mismatch.** `estimate_flow` grid is `(size//block)^2` but the codebook is `cfg.grid^2`. At the real 256px frames with the old hard-coded `block=8` that is 32×32=1024 vectors vs a 64-vector codebook → `encode_clip` (3334 tokens) ≠ `decode_clip` (454) and NO motion tokenizer could be trained/decoded. Fix: `MotionTokenizer.block_for/flow_block` derive the block from frame size and grid; `encode_pair`/`training_step`/`encode_clip`/`train_motion_tokenizer`/the video-track notebook all use it. Regression: `test_sham_live_motion_video.py`.
- **Orphaned motion tokenizer (v2 Studio).** `serve.py` loads `_state["motion_tokenizer"]`, but `modelscope-sham/app.py`'s explicit-kind path called `make_media()` WITHOUT it → every `video` request returned `NO_VIDEO`. Fixed + pinned in `test_media_backend_selection.py`.
- Reality check: the v2 **chat** Studio's video (`cpu_video.py` AnimateDiff) is a legit external engine, separate from the internal motion-token video; v2 image routes to an external studio via `mediaEngines.ts`. The internal Sham generator is still "training / testing only" per the owner's own labels.

## Nova 1 / Nova 2 T-LDM on Sham 2's technique (built 2026-11-18, committed, NOT pushed)
Owner's ask: develop Nova 2 the way Sham 2 was, apply the same to Nova 1, independence is a hard condition.
Sham 2's "technique" = a small trained head over a FROZEN reader + a per-task gate + an audience switch + an owner deny-list.
What landed: `src/lib/novaTldm.ts` (Nova's own client, imports nothing from Sham, no default model, honest
`reason:"no-fallback"` error), `tldmPolicy.ts` keyed per model (`tldm_open:<model>`/`tldm_deny:<model>`,
env `SHAM_/NOVA1_/NOVA2_TLDM_OPEN`), the Nova loop branch in `coderSections.ts` (uses the chat model's own head; a head
error ENDS the run with the model's own line — the outcome deliberately carries no `failure` so the outage-retry loop
cannot swallow it), `/tldm` + its button now follow the chat's model, trainer `nova_mode/run_nova/nova_donor/nova_run_key`
(per-Nova donor, config, work folder, head file, head repo, recipe key; ambiguous name refused; `--terminal sandbox`, never
Sham's embedded computer), `ai-system/tldm/configs/nova{1,2}.yaml`, `docs/coder/NOVA_TLDM.md` + `REVIEW_NOTES.md`,
tests `src/lib/__tests__/novaTldm.test.ts` (13) and `ai-system/modelscope-trainer/test_nova_tldm_job.py` (11).
**Real blocker, do not "fix" by faking it:** Nova 1/2 are served by llama.cpp (GGUF) — no `generate_tldm` endpoint and no
PyTorch body for frozen reader features. A Nova head can be TRAINED and PUBLISHED today, not SERVED. Serving needs a
per-Nova PyTorch head server (a memory-cost decision on a free CPU box), not a code tweak.
Model ids: Sham Pro = `sham_v2`, Nova 1 = `coder`, Nova 2 = `nova2`; Sham 1 and `lfm25` have no T-LDM path.

## Pushing this repo from an OpenHands session FAILS (403) — diagnosed 2026-11-18
`git push` to `jonsnow-org/Ttbik` is refused: "Permission to jonsnow-org/Ttbik.git denied to jonsnowx1r-lab".
The injected `GITHUB_TOKEN` (a `ghu_` token for user `jonsnowx1r-lab`, also what `gh auth token` and the
credential helper return) is a **read-only GitHub App installation token**. The proof is asymmetric: every READ
succeeds (`GET /repos/.../git/refs/heads/<b>` → 200) and every WRITE fails with "Resource not accessible by
integration" (POST refs, PUT contents, POST issues, POST forks — all 403). The `/repos/.../Ttbik` JSON advertising
`permissions.push: true` is the *user's* role on the repo, not the token's grant, so do not trust it.
Also tried and failed: `OH_GIT_CREDENTIAL_ACCESS_TOKEN_GITHUB` (401), `x-access-token:` and `x-token-auth:`
usernames, `http.extraheader` bearer, `gh` CLI (same token), SSH (no ssh binary, no ~/.ssh). The account owns no
fork of Ttbik. **Conclusion: this session cannot push to this repo at all.** Commit locally, leave the remote URL
clean (`https://github.com/jonsnow-org/Ttbik.git`), hand the owner patches, and do not burn steps retrying.
Deliverables that DO work: `git format-patch <base>..HEAD -o <dir>` (owner applies in sequence) and a thin bundle
`git bundle create f.bundle ^<base> HEAD` (~40K); a plain `git bundle create f.bundle <ref>` drags in full history
(69MB) and a bare bundle of a shallow clone cannot be cloned at all.
