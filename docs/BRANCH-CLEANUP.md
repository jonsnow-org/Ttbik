# Branch cleanup — Nov 4, 2026 (owner-authorized review of old PRs)

Never touched: #184, #505, #237 (promo, another project).

| PR | Decision | Why |
|----|----------|-----|
| #636 `fix/sham-v2-smoke-after-deploy-rebased-20261103` | Updated with production; merge when CI is green | Still useful: the Sham v2 live smoke runs only after a successful deploy (`workflow_run` guard). |
| #546 `fix/sham-v2-smoke-after-deploy` | Closed, branch deleted | Superseded by #636 (same guard, rebased). |
| #566 `claude/nova-task-test2` | Closed, branch deleted | Obsolete: the Nova task live test passes end to end on production (run 41743559341); the Oct 31 branch conflicts with later work. |
| #530 `ci/sham-v2-internal-check` | Closed, branch deleted | A one-off read-only investigation (Oct 28); Sham v2 media now runs on its own Studios. |
| #646 `fix/dedicated-candidate-token-and-workflow-shell-20261103` (draft) | Closed, branch deleted | Its premise (a stale token caused the 404) was disproved: ModelScope emptied the repos (#680), and Qwen loads with the existing token. The still-valid curl line-continuation fix moved to #685. |
| #647 `grok/nov4-model-repos-inventory` (draft) | Left open as a draft | Read-only inventory of all model repos. It partly overlaps #678 (an audit of one weight repo). It stays a draft under the earlier standing rule; the owner decides. |
| #679 `fix/video-subprocess-think` | Closed as superseded | Its commits shipped inside #681 (baa450dc1). |
| #685 `fix/donor-workflow-curl-continuation` | Open | Merge only when no donor-bakeoff run is in progress: a push run cancels the running one (shared concurrency group). |
