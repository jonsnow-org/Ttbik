# A second, free, CPU-only copy of Sham v2

Owner request (2026-11-04): host a second copy of Sham v2 somewhere free, CPU only, with no GPU and nothing paid.
The copy runs the same code and weights as the `sham-v2-server` Studio:
- app staged by `scripts/transplant/stage_sham_v2_studio.py`
- weights from the private model repo `novaai2026/sham-v2`, about 6 GB

Old Sham v1 is not touched.

## What is here
| File | Purpose |
|---|---|
| `Dockerfile` | CPU image: python 3.12, CPU torch, the Studio's requirements, Gradio on port 7860. Weights download on first start into `/data`. |
| `build.sh` | Stages the app and builds the image (`hosting/sham-v2/build.sh sham-v2:cpu`). |
| `run.sh` | Runs it on a Linux VM with `--restart unless-stopped`, 11 GB memory cap, 2 CPUs, and port 7860 bound to localhost. |
| `.github/workflows/sham-v2-host-image.yml` | CI build check. Nothing is pushed and no secrets are used. |

The VM needs these environment variables. Only their names appear here; the values go in `/etc/sham-v2.env` on the VM and are never committed.
- `MODELSCOPE_API_TOKEN`
- `SHAM_CODE_SIGNING_KEY`

Sizing: about 8 GB RAM at run time and 15 GB disk, so a free host needs at least 12 GB RAM.

## Free hosts compared (CPU, free, no GPU)
| Host | Free resources | Fits Sham v2? | Needs owner action |
|---|---|---|---|
| **Oracle Cloud Always Free, a NEW tenancy** (recommended) | Ampere A1 ARM: 2 OCPU / 12 GB on accounts after the June 2026 change; 200 GB disk | Yes. Note the image is multi-arch: the python and torch CPU wheels exist for arm64. | **Yes: sign-up.** The current tenancy's free A1 quota is fully used by the site VM. |
| ModelScope: a second Studio on the same account | 2 vCPU / 8 GB (platform/2v-cpu-8g-mem) | Tight. `sham-v2-server` and `sham-v2-overflow-server` already exist and both showed DeployFailed on Nov 2. A third Studio adds no diversity. | No |
| Hugging Face Spaces, CPU basic | 2 vCPU / 16 GB; sleeps after 48 h idle | Yes, via the Docker SDK (this Dockerfile, port 7860). | **Yes: sign-up, plus an explicit owner OK.** Project rule: HF is used for downloads only. |
| Render / Koyeb / Fly free tiers | 512 MB to 1 GB RAM | No | — |
| AWS / GCP / Azure free tiers | 1 GB RAM micro VMs | No | — |

## Owner steps for the recommended host (Oracle Always Free, new tenancy)
1. **Owner only:** sign up at https://signup.cloud.oracle.com with a different email from the site's tenancy. Choose a home region with A1 capacity (for example Frankfurt or Amsterdam). Oracle asks for card verification but does not charge Always Free resources. Do not upgrade to Pay As You Go.
2. **Owner only:** create the VM:
   - Compute → Instances → Create.
   - Image: Canonical Ubuntu 24.04 (aarch64).
   - Shape: VM.Standard.A1.Flex with all free OCPU/RAM (2 / 12 GB).
   - Boot volume: 100 GB.
   - Paste an SSH public key.
3. Send the agent the VM's public IP and SSH user (`ubuntu`). Do not send the private key in chat; the agent will use the box's own key, whose public half it can show.
4. The agent then runs the following, with no owner action:
   - install docker: `curl -fsSL https://get.docker.com | sh`
   - `git clone` the repo
   - `hosting/sham-v2/build.sh`
   - `run.sh`
5. **Owner only:** put the two values into `/etc/sham-v2.env` on the VM (`sudo nano /etc/sham-v2.env`, mode 600), or approve the agent copying them from the repo secrets through a one-off workflow.
6. The site reaches the copy through a private tunnel (Cloudflare Tunnel or Tailscale, both free). The URL goes into `SHAM_V2_OVERFLOW_URL` only after a live chat check, so the copy joins Sham v2's own pool (`src/lib/shamPool.ts`) and never another model's.
