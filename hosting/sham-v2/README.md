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

## Decision (owner condition t87u: free FOREVER, never stopped by usage limits or credit): **Oracle Always Free A1**
Checked 2026-11-04 against the official pages: docs.oracle.com "Always Free Resources"; huggingface.co/docs "Spaces Overview", "Using GPU Spaces" and "Manage your Space".

| | Oracle Always Free (Ampere A1) | Hugging Face Spaces, CPU basic |
|---|---|---|
| Free forever? | **Yes.** Free "for the life of the account", in the home region. | **No longer, for this use.** The hardware has no hourly cost, but *creating* a Gradio or Docker Space now requires a paid plan (PRO). Without it the API returns HTTP 402. Only static Spaces are free. |
| CPU / RAM / disk | 2 OCPU (2 physical Arm cores) / 12 GB / 200 GB block storage, persistent | 2 vCPU / 16 GB / 50 GB, not persistent (weights download again on every restart) |
| Sleep / idle | Reclaimed only when CPU p95, network **and** memory are all below 20% for 7 days. Sham v2 keeps about 8 of 12 GB resident (about 65%), so it is never idle. No keep-alive is needed; a cron health check restarts the container. | Sleeps after 48 h without visits, and the sleep time can't be changed on free hardware. An external ping could keep it awake, but the paid-plan requirement already rules it out. |
| Capacity | A1 can fail with "out of host capacity". Retry in another availability domain or later. Pick a region with capacity at sign-up. | n/a |
| Sign-up | A card is checked at sign-up and Always Free resources are never charged. Do **not** upgrade to Pay As You Go. Oracle allows one free tenancy per person, so the new tenancy must be in the owner's own legitimate details, not a duplicate identity. | Account plus PRO subscription. |
| Existing account | **Full.** The site/bot VM already uses the tenancy's whole A1 allowance (2 OCPU / 12 GB; see deploy/oracle/README-AR.md). | — |
| Expected Sham v2 speed | About the same as its 2 vCPU ModelScope Studio. Two full Arm cores (not hyperthreads), but no AVX-512/AMX, so roughly ±30%. Not measured yet. | Similar (2 shared vCPU) |

**Decision: Oracle.** Hugging Face fails the "free forever" condition (PRO is required to create a Docker Space), so it is not implemented, even though the owner authorised it.
- If Oracle sign-up is impossible, the free fallback is a third ModelScope Studio (2 vCPU / 8 GB, free). It is tight, and it sits on the same platform.

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
