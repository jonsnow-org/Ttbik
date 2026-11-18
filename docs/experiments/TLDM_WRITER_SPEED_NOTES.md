# T-LDM writer speed: running notes (PR #1125, branch claude/tldm-writer-speed)

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
