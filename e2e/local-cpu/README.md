# Real CPU end-to-end runs (opt-in, never part of CI)

Runs Sham v2's real agent loop (`shamAgentRun`, real tool schemas, real GitHub reads on a public repo, local temp dir as the sandbox)
against the real Qwen3-1.7B body in Sham's own class, on CPU only. No external model/media service is used.

1. `STUDIO_ENV=fixed python e2e/local-cpu/sham_v2_local.py`   (port 7872; `STUDIO_ENV=prod` = the old 384-token window / 96-token cap, for before/after)
2. `cd athar && npx jest --config ../jest.e2e.config.js --rootDir .. shamV2Agent`

The model is sampled, so a scenario can fail on one run and pass on the next; run it 3 times and read the log lines
(`tool:` = call the model made, `info:` = real result).
