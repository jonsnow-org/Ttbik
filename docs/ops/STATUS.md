# STATUS-NOV (Grok Bot, lead engineer) — updated 2026-11-04

## Merged
- PR #648 → f776f93eb (production `claude/free-services-marketplace-h6rwk2`). It covers:
  - Media intent is decided by the selected model in code, follow-ups included, with thinking off and the prompt written in the same call.
  - No "writing an English prompt" talk; captions are off unless MEDIA_SHOW_PROMPT=1.
  - 12-hour clock on the card and in the Mini App.
  - Never claims a file was sent when none was delivered.
  - Audio support in the fast lane.
  - Router safety: a NO answer gives an honest refusal; safe requests (swimsuit, beach, portrait) pass.

## Merged (cont.)
- PR #649 → 714de213e (LFM2.5 first-class, strict independence, Sham v2 host package). Vercel/Oracle verification is pending for this SHA.
- For f776f93eb (#648): Vercel success; oracle-freshness SAME BUILD (509 texts).

## Live (Nov 4, 01:24 Istanbul time)
- lfm25-media-server was created (HTTP 200) on its own private repo novaai2026/lfm25-media-models and reached phase ready.
  - Probe run 41728502589: image PASS 512x512 in 8 s; speech PASS 4.0 s of audio in 5 s; video PASS 29 frames in 391 s (slow).
- Coder redeploy run 41728502663:
  - Done: coder-inference-server and -2 succeeded.
  - In progress: -3.
  - Still to deploy: -4 (back to Qwen), -5, and lfm25-inference-server.
- PR #650 (live probes: lfm25 + audio; model input for nova-task-live): CI running.

- PR #650 merged → 8ee7bed35.
- Computer hub smoke (run 41731182035):
  - PASS: bash, persistent files, background jobs, X11 plus terminal.
  - FAIL: headless browser (TargetClosedError). Root cause: the worker launched Chromium without the persistent lib env.
  - Fix: PR #651 (grok/nov4-browser-env), CI pending. After merge the hub redeploys and the smoke runs automatically.
- Live probes dispatched on production: media coder image+audio (run 41731075754) and nova-task-live coder (run 41731085402).

- Coder redeploy run 41728502663 finished (success, all six Studios):
  - Replicas 1-5 are back on Qwen.
  - lfm25-inference-server is ready with LFM2.5-8B-A1B-Q4_K_M (CPU has avx512 and amx).
- Live Nova (production code):
  - task (run 41731085402): done in 795 s; slow, run while the Studios were redeploying.
  - image (run 41731075754): OK in 187 s.
  - audio: went to the worker, then 'internal error'. The cause was hidden by the log grep. Fix: PR #652 (tests + grep).
- PR #651 merged (browser env fix). The computer hub redeploys automatically and the smoke follows.
- Dispatched nova-task-live with model=lfm25 (run 41733574542).

- **LFM2.5 live task** (run 41733574542, production handler): same repo-explain task finished in **198 s vs Nova 795 s**. It ran on 'الاستوديو 2', which is LFM's global index, so no Nova Studio was used.
- PR #652 merged (audio tests + log grep).
- **Owner priorities t84u** (in order): computer pro → separation → slowness → forgotten model → permanent free Sham v2 host.
- PR #653 grok/nov4-computer-pro:
  - Tools: computer_patch, computer_test, computer_tools.
  - Persistent apt cache; tier reorder.
  - LFM added to COMPUTER_MODELS (it had no computer).
  - Revision r6 (fixes deploy assert failure run 41732789932).
  - Bench workflow: before on the PR, after on deploy.

- **Computer bench BEFORE** (live hub r4, PR #653 bench job):
  - Each RPC takes about 1.8–2.2 s: echo 1.88, write 200 KB 3.04, read 1.79, search 2.06.
  - repo_clone FAILED (RPC returned null); patch and tools were unknown actions.
- PR #653 merged → 88094d5f0. Hub deploy 41735560204 is running; the bench (after) runs on deploy success.
- PR #654 (host docs): Oracle Always Free is now 2 OCPU / 12 GB (verified on docs.oracle.com), and Sham v2 fits. The owner signup is still required.

- PR #654 merged (8976605de).
- PR #655 is open:
  - repo fetch answers in 12 s;
  - tips are guarded;
  - the bench reports repo_clone_total;
  - ownMediaBase refuses nova-inference-server (t86u: the hub is computer-only and lean, with caches on /mnt/workspace).
- Live media run 41736632699 (coder and lfm25, audio and image) checks the Nova audio internal error.

- PR #655 merged (f1c1dbedf). Hub deploy 41737173067 (it supersedes the cancelled 41735560204).
- t87u host decision: **Oracle**. HF Docker Spaces now need PRO (HTTP 402), which fails free-forever. PR #656 updates the README.
  - The owner's existing tenancy has no A1 left.
  - The owner must sign up for a new tenancy (one per person; card check; no PAYG).

- Merged:
  - #656 (4caf9c308): host decision.
  - #657 (5cdf4a66c): media submit retries a 429. Vercel success. Oracle SAME BUILD not re-checked for 5cdf4a6.
- Hub deploy 41737173067 succeeded.
  - Smoke 41738303227: everything PASSES, including Chromium (the #651 fix confirmed).
- BENCH AFTER (41738303302), seconds:
  - echo 1.76; write 200 KB 2.73; read 1.77.
  - repo: answers in 13.26 ✅ (before: FAIL null); total clone 106.
  - search 10.67 (it ran right after the clone); tools versions 2.63.
  - patch 4.34 ✅ (new); tools 1.87 ✅ (new).
- Next for the hub:
  - The 106 s clone (codeload vs the niced git baseline commit).
  - Search at 10 s.
  - The ~1.8 s gateway floor per RPC means work should be batched into fewer calls.
- Live media run 41736632699: coder image OK in 144 s; lfm25 audio OK in 21 s; lfm25 image OK in 52 s; coder audio hit HTTP 429; fixed in #657. Rerun 41738809574: coder audio OK, 136 KB in 14 s.

- #658 merged (d28944191): computer_batch, grep skips .git, clone markers; hub deploy 41740227036 is running.
- #659 merged (6b3ca9f8f): 12-hour clock.
- #660 open: orphan resume up to 6 h, resume cap, live disconnect E2E (drop_continue).
- Sham v2 Studios are all UP and ready (studios-all-status 41739999092); the DeployFailed is resolved. Sham v1 returns 404 (being retrained; hands off).
  - Sham v2 chat smoke 41740197650: factual and multi-turn PASS.
  - The terminal part got HTTP 401 during the hub redeploy; rerun after the deploy.
  - Seen in the factual answer: a Vietnamese word ("của") leaked into the Arabic. That is v2 model quality.
- Owner feedback items: the English-prompt talk, false "sent" claims and slow simple media were already fixed in code (verified); the 12-hour clock was done in #659.

- **Merged:**
  - #660 (623ae2859): long-task resume.
  - #661 (c532e1e84): HANDOFF.
  - #662 (65fc14ab9): repo fetch stall/retry/reuse.
  - #663 (7749e9843): HF inventory workflow.
- **Live disconnect E2E** (41741943513, lfm25): hand-off dropped → resumed at 122 s → done at 318 s; 1 message, none over 4096 characters. PASS.
- **Bench after #658:** batch_5 3.17 s for 5 steps (vs ~10 s separately); search 1.98 s (was 10.7). The second clone FAILED at 45.8 s; #662 addresses it.
- **#664 open:** every model gets the owner switch; candidates unlocked behind the switch, with user tier and quota.
- **t88u Oracle:** no OCI credentials and no SSH secret are in the repo, so the tenancy usage can't be read.
  - From the docs: the A1 VM is 2/12 and the compose limits already add up to 4+4+1+1 GB, plus the Sham v1 runner's 4 GB cap.
  - The disk is ~79% full.
  - The E2.1.Micro has 1 GB, too small.
  - Result: the current account does NOT fit Sham v2 (8 GB).
  - HF inventory run 41742749216 checks whether the owner's existing Spaces can be reused.

## Open (earlier notes)
- PR #649 `grok/nov4-batch2-lfm25`, which makes LFM2.5-8B-A1B first-class. Contents:
  - Its own engine pool (AsyncLocalStorage), its own media Studio, a registry entry, and strict override (no fallback).
  - Nova replica 4 back to Qwen.
  - docs/MODELS.md.
  - The Sham v2 host package (hosting/sham-v2) with its CI build check.
- After merge:
  - The push redeploys all coder Studios (one at a time) plus the new lfm25-inference-server.
  - Run `deploy-lfm25-media.yml` by workflow_dispatch: it seeds lfm25-media-models, then lfm25-media-server.
- Draft PR #647: read-only ModelScope repo inventory probe. Keep as a draft; do not merge.

## Findings
- The forgotten fast model is LFM2.5-8B-A1B (LiquidAI/LFM2.5-8B-A1B-GGUF Q4_K_M, ctx 32k, about 58 tok/s read and 11.6 tok/s write).
- Before #649 it hid as Nova replica 4 and was used as the translator for every model.
- nova-video-gen (CogVideoX-2b, 14.3 GB) and nova-vision-7b-gguf (Qwen2-VL 7B) are dormant and too slow on CPU.
- sham-donor-qwen35-9b-weights and sham-donor-gemma4-e4b-weights are empty repos (.gitattributes only).
- On Nov 2, sham-v2-server and sham-v2-overflow-server were DeployFailed, and umranz-sd15-image-test returned 502.

## Owner blockers
- The second Sham v2 host needs an Oracle Always Free sign-up on a new tenancy (steps in hosting/sham-v2/README.md). HF Spaces is the alternative but needs explicit owner OK.

## Remaining
- Live verification per model through the production handler, including LFM after its Studio is ready.
- Sham v2 Studio DeployFailed: investigate (Sham v2 only; never v1).
- Long tasks: verify resume, run_id idempotency, heartbeat, 4096 chunks and long output as files, end-to-end.
- Computer proof run per user:model (shell, file, browser).
- Benchmarks before and after (studio bench workflows).
- Update docs/HANDOFF.md.
