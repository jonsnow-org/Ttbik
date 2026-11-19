# Stage 1 run state

The Stage 1 workflow was launched once from the commit that introduced the gated job.

The run is serialized under the `sham2-stage1-partial` concurrency group. Follow-up commits must not retrigger another training run unless the active run has failed and its logs have been reviewed. This file is a review note only; it does not request a Stage 1 run.
