# T-LDM writer speed: running notes (PR #1125, branch claude/tldm-writer-speed)

## Headline: one run, same machine (run 44261094320, commit 34bc3de, tldm_writer_speed_runner_same_run_2026-11-18.jsonl)
GitHub runner AMD EPYC 9V74 (Zen 4), 4 vCPU, AVX-512, **no AMX**; 2 threads; 0.3B config (369.3M params, block 128); batch 1; median of 7.

| configuration | passes | input bytes | ms | tok/s |
|---|---|---|---|---|
| before: fp32, default schedule | 10 | 64 | 1911 | **67.0** |
| fp32 + parallel 0.7 + trim | 2 | 24 | 494 | 258.9 |
| int8 (first version: quantize_dynamic, attention fp32) + parallel 0.7 + trim | 2 | 24 | 266 | 481.4 |
| **int8 (this PR: every Linear incl. q/k/v/out, latent K/V cached) + parallel 0.7 + trim** | 2 | 24 | 112 | **1139.1** |
| same, full 64-byte input | 2 | 64 | 140 | 915.0 |
| same, default 10 passes (no lossy option at all) | 10 | 24 | 418 | 306.1 |
| same, batch 4 | 2 | 24 | 387 | 1323.1 |

Split (int8, batch 1): reader 24-50 ms, thinker 9.5-10.9 ms (was 48), one writer pass 37.6 ms (was 92.5 with int8_ffn, 157.8 fp32).
Held-out on the trained donor checkpoints (gate_int8v2): int8 + end_exit + parallel 0.7 = baseline on every checkpoint (heldout 0.917/0.667/0.75, heldout2 0.857/0.786/0.786), identical decoded text on every row, mean passes 2.11 / 1.46.

Kept in the branch so progress survives interruptions. tok/s = block x batch / wall time of one full generate (reader + compressor + thinker + writer), the book's counting.

## Quiet hardware: GitHub runner (run 44254789952, commit b94d603)
Intel Xeon Platinum 8370C @ 2.8 GHz, 4 vCPU = 2 physical cores x HT, AVX2 + AVX-512 VNNI, **no AMX** (laptop-class core count). 0.3B config (369.3M params, d=1280, 12 reader + 4 writer layers, block 128), input = 64 bytes, batch 1, median of 5.

| mode | threads | passes | ms | tok/s |
|---|---|---|---|---|
| fp32 (before) | 4 | 10 | 1492 | 85.8 |
| fp32 | 2 | 10 | 1283 | 99.8 |
| int8 | 4 | 10 | 892 | 143.5 |
| int8 | 4 | 2 | 264 | 485.3 |
| int8 | 4 | 1 | 191 | 671.6 |
| **int8** | **2** | **2** | **223** | **573.8** |
| int8, batch 4 | 4 | 2 | 748 | 684.7 |
| bf16 (no AMX: slow) | 4 | 2 | 1371 | 93.3 |

2 passes = what `parallel=0.7` actually needs on the trained gate checkpoints (1.2-1.9 mean). 2 threads beat 4 here (HT siblings share one core).

## Held-out gate (eval/writer_speed_gate.py, MiniLM donor checkpoints donor_s0/1/2, batch 1)
donor_s0: baseline train 0.967 / heldout 0.917 / heldout2 0.857. Every option (end_exit, parallel 0.9/0.7/0.5, confident 0.9, bf16, int8, int8+parallel 0.7) gave the same accuracy and the SAME decoded text as baseline on every row. parallel 0.7 mean passes: heldout 1.92, heldout2 1.21-1.29.
donor_s1: baseline 0.967 / 0.667 / 0.786; end_exit, parallel 0.9/0.7 identical text.
(gate timings on the shared box are contention noise; use the runner numbers above.)

## Trailing-PAD trim (Sham1_TLDM.generate, trim=True)
Exact: identical text on every train/heldout/heldout2 row of small_reword0.pt in fp32 and int8. Gate tasks average 23-27 bytes of the 64-byte window, so the reader reads ~2.5x fewer positions.

## Bottleneck split (int8, 2 threads)
reader ~40% (12 Mamba layers: int8 linears + ~60% elementwise scan ops), thinker ~10%, each writer pass ~25-35%.
