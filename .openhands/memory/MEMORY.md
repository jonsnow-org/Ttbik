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
- Computer hub: `ai-system/modelscope-media/computer_studio_app.py` `APP_REVISION` (currently `computer-hub-16gb-2026-11-04-r7-live`) ↔ `.github/workflows/deploy-minicpmo-big.yml` (2 asserts) ↔ `scripts/ops/modelscope_computer_hub_preflight.py` ↔ `docs/MODELS_AND_COMPUTER.md`.
- Donor bakeoff: `experiments/donor-bakeoff/app.py` `APP_REVISION` (currently `donor-bakeoff-2026-11-05-r21`) ↔ `src/lib/donorTests.ts` `EXPECTED_DONOR_APP_REVISION` / `ACCEPTED_DONOR_APP_REVISIONS`.
- Other app revisions asserted in workflows: `epicrealism-image-test-2026-10-31-r1`, `juggernaut-ragnarok-cpu8g-2026-10-31-r2`, `umranz-image-test-2026-10-31-r3`.

## Architecture: models are independent
`docs/MODELS.md` is the registry. Each model (`coder`=Nova AI, `sham`, `sham_v2`, `lfm25`, `qwen35-9b`, `gemma4-e4b`, `minicpmo45`) has its OWN inference + media Studios and its own computer session (`<userId>:<model>`). No fallback to another model; unconfigured → honest error. Key files: `src/lib/coderModels.ts` (registry/access), `src/lib/openCoderStudio.ts` (`ENGINE_MODELS` = coder+lfm25 only), `src/lib/modelMedia.ts` (media routing), `src/lib/modes.ts` (modes/thinking), `src/lib/novaBotLogic.ts` + `src/lib/shamStudio.ts` (Sham paths).
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

## ⛔ Pushing/merging from this sandbox is BLOCKED (2026-11-06)
The injected `$GITHUB_TOKEN` is a **read-only GitHub App token** (`jonsnowx1r-lab`): the API reports
`permissions.push=true` but EVERY write is refused `403 "Resource not accessible by integration"` — git push
(`https://TOKEN@` and `x-access-token:TOKEN@`), `POST/PATCH /git/refs`, `POST /pulls`, and the `create_pr` tool.
Empty `x-oauth-scopes`; no SSH binary, no `~/.ssh`. The clone's original embedded token (the value in the clone's git config) is expired (401).
Reads are fine. So commits can be made locally but **cannot be pushed**; the owner must supply a token with
Contents:write (+ Pull requests:write) before any merge lands. Verify with
`curl -s -X POST -H "Authorization: Bearer $GITHUB_TOKEN" .../git/refs -d '{"ref":"refs/heads/t","sha":"<HEAD>"}'` — a 403 means write is off.

## Sham v2 chat deploy readiness (fixed 2026-11-06, live) — NOT flaky
`Deploy the Sham v2 Studio` failed DETERMINISTICALLY: a redeploy leaves the PREVIOUS container answering `/status`, and the pre-2026-10-30 app reports `phase=ready` WITHOUT `context_tokens`. Gate on `context_tokens>=4096` (in `deploy-modelscope-sham-v2.yml` + `-overflow.yml`), never just `phase==ready`; ModelScope may print `no change` and not rebuild. Second trap: steps run under `bash -e`, so a failing grep inside `ctx=$(... | head -1)` aborted a deploy silently — append `|| true`. Regression test: `test_sham_v2_chat_smoke.py::test_deploy_waits_for_the_new_app_context_not_the_previous_container`.
