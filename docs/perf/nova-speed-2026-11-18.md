# Nova 1 / Nova 2 speed, 2026-11-18 (measured through the live Studios, `nova-speed.yml`)

Times in seconds. TTFT = queue wait + prompt reading until the first token (Studio clock). Each model measured on its own Studio only (no routing).

## Before (runs 44246181527 Nova 1 Studio 2, 44246178017 Nova 2 Studio 16; 05:43-06:11 UTC)

| step | Nova 1 TTFT | Nova 1 gen tok/s | Nova 2 TTFT | Nova 2 gen tok/s |
|---|---|---|---|---|
| greeting (lite, ~300 tok) | 18.4 | 4.7 | 43.3 | 2.25 |
| greeting again | 13.4 | 5.9 | 46.1 | 2.35 |
| full start, cold (Nova 1 9,074 tok; Nova 2 9,085 tok / 44 tools) | 258.0 | 3.4 | 1258.9 | 1.6 |
| full start, new conversation (start held) | 8.1 | 3.5 | 56.5 | 1.4 |
| generation ~250 tok | 8.1 | 3.5 | 17.8 | 1.6 |

Prompt reading: Nova 1 ~36-47 tok/s, Nova 2 ~7 tok/s.

## Incident found while measuring

#1112 (held starts / warm-up) split `_view`'s if/elif chain in `app.py`: every pending and done answer came back as `type: "error"`
(Nova 2 deploy probe: `status: done, text: pong, type: error`; nova-speed run 44251647445: every step error in 2.6 s). Bot users saw
"خطأ من خادم المبرمج". Fixed in #1118 (9683a5d8) with a test; redeployed Studio 16 (run 44253096873) and the cn pool (run 44253079548).

## After (#1112 + #1118 deployed)

Nova 1, run 44254973600 (Studio 1, 200 s after a restart, live traffic):

| step | TTFT | prompt total / cached / read | gen tok/s |
|---|---|---|---|
| greeting | 7.0 | 304 / 0 / 304 | 4.97 |
| greeting again | 7.2 | 336 / 0 / 336 | 4.78 |
| full start, cold | 258.7 | 9,327 / 0 / 9,327 | 3.14 |
| full start, new conversation (held start restored from disk) | 45.2 | 9,330 / 9,300 / 30 | 3.12 |
| generation ~250 tok | 6.1 | 9,345 / 9,300 / 45 | 2.89 |

Nova 2: see below (run 44254970139).

## Decode bench, Nova 2's exact file (run 44250853555, GitHub runner pinned to 2 cores, ctx 16384)

baseline: prose 5.0 tok/s, edit 4.6 tok/s, reads 15.3 tok/s; ngram-mod: prose 5.0, edit 6.1, reads 15.2.
The Studio (2 vCPU, 15.35 GiB, 12.3 GiB model file) does 1.4-2.3 tok/s and reads 7 tok/s: about 3x below the same file on 2 runner cores.
Hypothesis: memory pressure (mmapped weights re-read from disk). #1123 adds llama-server major page faults / RSS / cgroup memory to
`status` and per job to confirm it before changing any flag.
