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

## Free hosts compared (permanently free; trials excluded)
Facts checked 2026-11-04 against Oracle's Always Free documentation (docs.oracle.com, "Always Free Resources"):
- Ampere A1 is now **1,500 OCPU-h and 9,000 GB-h a month**, i.e. **2 OCPU / 12 GB total**. The old 4 OCPU / 24 GB figure was halved in mid-2026.
- Oracle may reclaim an Always Free VM as idle when, over 7 days, CPU p95 **and** network **and** memory (A1) are all below 20%.

| Host | Permanently free resources | Fits Sham v2 (about 8 GB RAM, 15 GB disk)? | Needs owner action |
|---|---|---|---|
| **Oracle Cloud Always Free, a NEW tenancy** (recommended) | Ampere A1 ARM: 2 OCPU / 12 GB, 200 GB block storage, 10 TB egress a month | **Yes.** The loaded model keeps memory near 65%, so it is never "idle" by Oracle's rule. arm64 CPU torch wheels exist, and `build.sh` builds natively on the VM. | **Yes: sign-up.** The site's tenancy already uses all its A1 quota (2/12) for the site VM. |
| Hugging Face Spaces, CPU basic | 2 vCPU / 16 GB / 50 GB, free with no time limit; sleeps after 48 h without traffic | Yes, via the Docker SDK (this Dockerfile, port 7860). | **Yes: sign-up, plus an explicit owner OK.** Project rule: HF is used for downloads only. |
| ModelScope: another free Studio on the same account | 2 vCPU / 8 GB | Tight. It also sits on the same platform as the first copy, so it adds no host diversity. | No |
| Google Cloud / AWS / Azure always-free micro VMs | 1 GB RAM | No | — |
| Render / Koyeb / Fly free tiers | 256 MB to 1 GB RAM | No | — |

## Owner steps for the recommended host (Oracle Always Free, new tenancy)
1. **Owner only:** sign up at https://signup.cloud.oracle.com with a different email from the site's tenancy. Choose a home region with A1 capacity (for example Frankfurt or Amsterdam). Oracle asks for card verification but does not charge Always Free resources. Do not upgrade to Pay As You Go.
2. **Owner only:** create the VM:
   - Compute → Instances → Create.
   - Image: Canonical Ubuntu 24.04 (aarch64).
   - Shape: VM.Standard.A1.Flex, 2 OCPU / 12 GB (the whole free allowance).
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
