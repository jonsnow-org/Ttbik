# Studios: which model uses which (checked in code and by `src/lib/__tests__/studioIsolation.test.ts`)

| Model | Studios | Env | Code |
|---|---|---|---|
| Nova (Qwen3.5-4B, llama-server) | `coder-inference-server`, `-2` … `-5` (list: `ai-system/modelscope-coder/STUDIOS`) | `OPEN_CODER_STUDIO_URL`, `OPEN_CODER_STUDIO_URLS` | `coderStudioUrls()` in `src/lib/openCoderStudio.ts` drops every Sham / `nova-inference-server` address |
| Sham (old, v1) | `sham-v1-server` | `SHAM_MODELSCOPE_URL` | `shamBases()` in `src/lib/shamStudio.ts` drops sham-v2, `nova-inference-server`, `coder-inference-*` |
| Sham v2 | `sham-v2-server` (+ replicas) ; video: `sham-v2-video-server` | `SHAM_V2_URL`, `SHAM_V2_VIDEO_URL` | `shamBases()` drops sham-v1 and Nova Studios |
| Sham v2 overflow | `nova-inference-server` (its name is historical: it serves Sham v2 only) | `SHAM_V2_OVERFLOW_URL` | `src/lib/shamPool.ts` (`orderV2`): used when the primaries are congested, or first under the owner's pressure mode |

## Load balancing and failover
* Nova: a new completion goes to the first healthy Studio (`CODER_STUDIO_BALANCE`), a job stays on the Studio that took it (`s<i>~<id>`), a failed Studio is skipped for 60 s. Tests: `coderBalance`, `coderFailover`, `congestionRouting`.
* Sham / Sham v2: calls start at a rotating Studio (users spread), a busy / unreachable one is skipped. Tests: `shamPool`, `studioIsolation` (rotation covers every v2 Studio).
* Isolation test: with an environment that lists EVERY URL in EVERY variable, Nova gets only Nova Studios, v1 only v1, v2 only v2 (the overflow joins v2 only through `shamPool`).

## Lint
`npm run lint` = `eslint src` with the flat config `eslint.config.mjs` (Next 16 removed `next lint`). 0 errors; the React-Compiler rules of eslint-plugin-react-hooks v7 and Next's link / img advice are warnings (fixing them changes component behaviour).
