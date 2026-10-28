# Branch cleanup — 2026-10-28 (Europe/Istanbul)

Remote branches deleted because EVERY commit of them is already in `claude/free-services-marketplace-h6rwk2` (`git rev-list --count prod..branch` = 0). Restore with: `git push origin <sha>:refs/heads/<name>`.
Not touched (also fully merged, but other projects — free tools): `feat/arabic-shift-calendar`, `feat/json-workbench-tool`; every `claude/*` branch (Athar / Zenobia / promo / platform / talking-photo / other projects), `grok/*`, `nova-*`, `sham-*`, #184's branch, and every branch that still has commits not in the production branch (see the review list below).

| branch | last SHA |
|---|---|
| `batch/10-studio-logs` | `268ab6ce382ae559f32e577c4b150898388a96f7` |
| `batch/11-studio-logs-decode` | `406e340461f601ab3802ec9b7a8697aff309461b` |
| `batch/12-video-lean-decode` | `4c5fa1bcc4b053c10d76f5787e5bf3b6b3923520` |
| `batch/13-chat-studio-no-video` | `1c615c1a53d6d8f31727eb34b74e36f312bf72aa` |
| `batch/14-model-repo-check` | `533dcb278ce16745039e091150baf870c834e802` |
| `batch/15-token-diag` | `d6a3be798bdc99651f3ad9c625bb08d24b670d63` |
| `batch/3-post-merge` | `a35dce2229df967d1155ed3164fd4545ea38b7dd` |
| `batch/4-sham-v2-video-disk` | `7de3ae2c0702030e81f9ffb34360b1aa013ac2fe` |
| `batch/5-studio-inventory` | `4abbb193b19540f4c922af823e4c50500788882e` |
| `batch/6-probe-after-deploy` | `7c6f01193dc1af4965dae08b1a7f26b6a1a6f11f` |
| `batch/7-freshness-live-prompt` | `db4768ceca563a709d07c0f1162c8358ab3f9853` |
| `batch/8-video-modelscope-lean` | `87480f431907695a05f24ddc90f69c19f393740e` |
| `batch/9-sham-v2-media-check` | `1a52231a566dfeb4a67b608bb532334b69707300` |
| `batch2-old-prs` | `07e122aa7c3cb6fd84f00b6c0bf61fa3dad7f929` |
| `chore/quarantine-huggingface-media` | `b1d0fc7c8d94ff96eca9eb21f068c5c08df8745f` |
| `feat/admin-media-visibility` | `14a75a56f6ba57bd766d472b1dbc612e749bd45a` |
| `feat/agent-card-2` | `1d887fe2ae11e8fea87cc5f3388498f2bd82f843` |
| `feat/agent-card-audit` | `39f83c1f9fc06285ce66a66754115ae025031308` |
| `feat/sham-v2-overflow` | `94173c48022bcef9182afb16092e53dbe9b351a2` |
| `feat/single-message` | `74dd3eca924bff9fa6aea3992adad7cc4bec7f64` |
| `feat/terminal-lease` | `1ebc190066afffeab83314381f26b5a05ec7e51d` |
| `feat/unified-shell` | `28e786a2e9a6407d46ee66414704ad50ab3dfb0f` |
| `fix/02-media-quality-gate` | `98656f591b8753550aa3a3f68ffd3bee2c01c644` |
| `fix/03-sham-v2-media-routing` | `1e742345994fa77d6c90f0ae1e0ac328d2e8537e` |
| `fix/04-nova-paused-split` | `6064a7ac7b19ebffa08aef0d519fabf082af33a1` |
| `fix/05-sham-v2-agent-e2e` | `ebe7d29c5a775dc9535a6379a18f8f66e5ed9c98` |
| `fix/06-cpu-video` | `96db1d41c58ca24eb62c5828094f3af3925f9544` |
| `fix/07-nova-single-reply` | `66ce0d22cbd601ddaaff6ca1558cf571047e1f40` |
| `fix/08-nova-media-own-path` | `effb6c162ab38d1126d5a04ce386076f3feebd95` |
| `fix/09-no-external-media` | `1052b65998c6df6320bdf43f5d0d8b43fbe74616` |
| `fix/10-nova-tiers-owner-exempt` | `7d41fbce05250335c3e6af818306e966ee65e9e4` |
| `fix/11-decouple-nova-sham` | `3c66b97a8df492a5588cc910a8c149fe06914faf` |
| `fix/12-miniapp-per-model-settings` | `2e273ed74214b88c1069f8951ca80055a0d85660` |
| `fix/13-sham-connectors` | `f249ffb1697ae723186655aae9a7d1591abaa48b` |
| `fix/14-chat-lists` | `deaafe9731aecb6a8097bdbccafc5b2167990696` |
| `fix/15-memory-settings` | `4cad4bd1c682ed6d56b7b8fd73adf92320e1e60e` |
| `fix/16-ci-hermetic` | `2794f76ac7485895f30f19276957e5f8830d290e` |
| `fix/17-nova-e2e` | `d45968cf4d7482eb2e3fc0786f253f844df3ad12` |
| `fix/18-post-merge-smoke` | `0e31e4a63727e62413ddec462cedf4a340035898` |
| `fix/chats-visible-stale-tasks` | `45bb00f1aab53c095492e52f1ee7374d231e17f8` |
| `fix/independent-media-generation` | `94d61a99fb9a0a629db2c5fc92db08d4d2d69e87` |
| `fix/nova-media-live` | `3332086d9cd044fa26e975f3ac5c2444b6927af0` |
| `fix/oracle-health-line` | `6541069b52bf877f309c692940230dd968e552ab` |
| `fix/restore-content-files-after-failed-deploys-2026-10-24` | `b6408e84c0071bc3e00e4f6b4be35425d728ae37` |
| `fix/sham-media-fast-lane` | `f1f174e7cd2c9560ef8f04a616cab221cd25ac0e` |
| `fix/sham-nova-isolation-and-modelscope-access` | `c5a167cb09c6f10a2f20e2ce795e101bbee31fb8` |
| `fix/sham-v2-local-media-video-args-current` | `19077f643f7cdad83444ad3fffd5af3d4341ad71` |

## Still to review (commits NOT in the production branch; not deleted)
ahead>0 count: 141. Examples with our-side relevance: `sham-media-selflearn`, `grok/sham-phase1-template-ready`, `nova-dev-agent/*`, `nova-self-improve/*`, `sham-notebooks-review`. Others are other projects (Athar, promo, platform, talking-photo, trading, referral, payments). Next step: per-branch `git diff prod...branch`; a squash-merged branch shows ahead>0 but an empty content diff.
