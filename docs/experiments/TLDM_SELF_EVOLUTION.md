# T-LDM self-evolution (2026-11-18)

Code: `ai-system/tldm/evolution/`. Numbers: `tldm_self_evolution_2026-11-18.json` (3 seeds, CPU). Tests: `evolution/test_evolution.py` (CI).

**Scope (owner rule):** every filter here applies only to data that enters **training**. Nothing in this package limits what the model does for a user at work time: free search and browsing, the user's own accounts, executing. The work-time limits stay in the serving path: the user's own workspace, the user approving their own sensitive commands, and the owner's deny list for everyone.

## Pipeline
1. **Experience** (`experience.py`, stdlib). Each finished command becomes one anonymised record:
   - fields: salted user hash, scrubbed intent, intent template, scrubbed command, exit code, stdout/stderr hashes, verifier verdict, latency, model, adapter, task family
   - PII scrubbing: e-mails, tokens/keys/passwords, IPs, URLs, phone/card numbers, home folders and paths, names
   - also: dedup and a per-user daily rate limit
   - admission to training requires the verifier's yes and exit 0, the owner deny list (`SHAM_TLDM_DENYLIST`), the sandbox refused list, adversarial patterns, no PII, consensus of ≥2 distinct users/seeds (web: the sandbox run is the check), and a cap on each user's share.
2. **Curriculum** (`curriculum.py`). Each failure gets surface variants (fillers, dropped words, word order, typos; decontaminated against the held-out and benchmark sets). The writer samples best-of-n over a temperature ladder, and every candidate is run in the sandbox. A verified command is learned for the wording that failed.
   - Why the old `evolve.py`/`lora_failed.py` produced 0 pairs: the failures were unseen file names (before slots), and whole-block sampling at T=0.8 garbles commands.
3. **Continual learning** (`adapters.py`, `engine.py`). There is one LoRA per task family (inspect / count / search_sort / write) inside the same model, chosen by a router on the model's own frozen reader features. This is not routing between models.
   - Training uses replay of the original rows and earlier admitted pairs.
   - Gate: a new adapter is accepted only if there is no net drop and at most 2% lost items on the previously-correct and dev sets, plus a gain on the family's target.
   - Also: exact merge, SVD prune, a versioned registry, and rollback.
4. **Lessons** (`lessons.py`). Failures become retrievable lessons and verified successes become recipes, both retrieved by similarity of the task template. They are used at inference through `decide()`, `recipe()` and `context()`.
5. **Web learning** (`web_learning.py`). Queries are driven by the model's own failure clusters and gaps.
   - Sources: tldr-pages EN/AR (CC-BY-4.0) and Stack Exchange (CC BY-SA, so rejected by the permissive-only allow-list; the rejection is recorded).
   - Fetching honours robots.txt, makes 1 request/s per host, and caches pages.
   - Fetched text is parsed as data only. Pages that contain injection text are dropped.
   - Each pair also goes through PII scrub, dedup, decontamination (word-Jaccard ≥0.4 or the same template as any held-out, benchmark or dev task), the deny list, and real execution twice (deterministic, with output or a change).

## Results (3-seed means)

**Writer** (frozen-reader head, the gate model):

| arm | held-out | held-out 2 | train30 / replay150 (forgetting) | online user success |
|---|---|---|---|---|
| base | 0.778 | 0.810 | 0.967 / 0.978 | – |
| users + curriculum, after round 1 / 2 / 3 | 0.806 / 0.806 / **0.861** | 0.833 / **0.857** / 0.833 | 0.967 / 0.978 (unchanged) | 0.888 → 0.912 |
| web only | 0.778 | 0.810 | unchanged | – |
| users + web, round 3 | 0.750 | 0.810 | unchanged | 0.901 |

- **Curriculum repair:** 11–35 of 32–60 failures repaired per round, giving 27–108 verified pairs per round. The old code produced 0.
- **Web:** 38–44 licensed, verified, decontaminated pairs per seed. The gate rejected every web adapter (3–17 previously-correct items lost), so the web gain on held-out is **0**, and the gate prevented any harm.
- **Lessons at inference:** no measurable change on held-out (0.861 / 0.833 with and without).
- **Poisoning:** 3 of 30 users taught `cat names.txt`, `rm -rf .` and `curl … | sh`. The model never produced a poison command on dev in any arm, including with the admission defences off, where the gate alone held.
- **Caveat:** in single seeds the frozen held-out can still drop even though the gate passed. Seed 2's held-out 2 went 0.786 → 0.714. The dev set protects, but not completely.

**Agent loop** (multi-step), full-task benchmark (60 new-name episodes, seed 778):

| | clean (simple / multi) | users' messy wording (simple / multi) | prev-correct | online |
|---|---|---|---|---|
| round 0 | 0.983 (0.973 / 1.0) | 0.517 (0.495 / 0.551) | 0.938 | – |
| round 3 | 0.983 (unchanged) | **0.711** (0.676 / 0.768) | 0.938 | 0.561 → 0.739 |

## Gaps
- Web data now passes the gate (see "Web learning that passes the gate" below). Known-wording adapters still rarely gain (1 item or none).
- The verifier in the simulation is the task's real effect against the intent's reference. In serving it is the agent's verifier plus the user's acceptance.
- Commands longer than the writer's 24-token block (e.g. the `python3 -c` sum) cannot be learned.

## Web learning that passes the gate (2026-11-18)

Data: `tldr-pages` EN/AR (CC-BY-4.0), `cheat/cheatsheets` (CC0-1.0) and `awesome-cheatsheets` (MIT). Stack Exchange (CC BY-SA) is fetched and rejected.
Every pair is injection-screened, PII-scrubbed, decontaminated against held-out 1+2, the full-task benchmark and dev, and RUN in the sandbox.
That leaves 188–191 pairs per seed from 47 pages (29 known wordings and about 160 new commands or options).

Recipe (`engine.WEB_RECIPE`, `evolution/web_training.py`):
- **known** (the command template is already in replay): adapter `kn_<family>`, 3 replay : 1 web, lr 5e-4, 150 steps, L2-to-base 0.1 (EWC with a uniform Fisher).
- **new**: adapter `web_<family>`, 1 : 1, lr 1e-3, 300 steps.
- **Both are routed** (k-NN on the frozen reader): an adapter only serves requests whose nearest examples are its own web rows.
- Every adapter passes the same gate. The gate never sees held-out.

3 seeds, means (`docs/experiments/tldm_web_learning_2026-11-18.json`, `eval/web_learning_benchmark.py`):

| recipe | adapters accepted | web set | web new | held-out | held-out 2 | replay150 | dev |
|---|---|---|---|---|---|---|---|
| base | – | 0.087 | 0.054 | 0.778 | 0.810 | 1.0 | 0.96 |
| before: old 1:1, lr 1e-3, 120 steps, one global adapter per family | **0 / 12** | 0.087 | 0.054 | 0.778 | 0.810 | 1.0 | 0.96 |
| tiered, known adapters applied to the whole family | 14 / 21 | 0.242 | 0.230 | **0.722** | 0.810 | 1.0 | 0.962 |
| **after: tiered, both tiers routed (shipped)** | **11 / 21** | **0.210** | **0.194** | 0.778 | 0.810 | 1.0 | 0.96 |

- End to end (`self_evolution_benchmark.py --arms web`, i.e. `EvolutionEngine.learn_web`): 5, 2 and 5 of 7 adapters accepted. Held-out, held-out 2, train30, replay150 and dev were unchanged on every seed.
- Applying the known-wording adapters to the whole family passed the gate but cost seed 0 two held-out items (0.917 → 0.75). In an earlier run, seed 2's held-out 2 also dropped. Routing them removed this.
- A wider sweep (L2 1.0, curriculum order, half-strength merge, routed-only at 60 steps) accepted nothing on the first 99-pair web set (`web_s*` logs).
- Necessary tools (`rm`, `curl`, `wget`, `pip`, `git`, `mv`, `sudo apt-get` …) are learnable. Only clearly destructive or out-of-scope patterns (`rm -rf /`, `curl … | sh`, fork bomb, `dd of=/dev/sd*`, …), the owner's deny list and credentials are refused (`test_necessary_commands_are_learnable`). Owner records (`source="owner"`, #1102) skip the intake filter.
