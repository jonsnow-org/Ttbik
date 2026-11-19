# Stage 1 run state

The first partial run, `44535299790`, is complete and failed its candidate gate; it is not an active training job.

That run completed 660 optimizer steps (identity 60 + terminal 600), saved a 256,908,174-byte v2 head, and produced 0/26 same-effect matches. The artifact is rejected and is not served. The root cause and v3 writer correction are recorded in `SHAM2_MODELSCOPE_ROUTING.md`. Do not retrigger training until offline CI passes and a new donor-only preflight has completed in `novaai2026/sham2-tldm` with a fresh run ID. This file is a review note only; it does not request a Stage 1 run.
