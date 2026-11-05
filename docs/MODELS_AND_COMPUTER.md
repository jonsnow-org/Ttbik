# Models and the dedicated computer hub (2026-11-02)

Inference and media weights remain isolated by model. The execution host is now a separate, dedicated computer-only Studio.

| Model | Chat Studio | Image / media | Computer |
|---|---|---|---|
| Nova AI (\`coder\`) | \`coder-inference-server\` 1–5 | Nova's own image/speech/video Studios | Shared 16 GB computer hub; private \`user:coder\` session |
| Sham (old) | \`sham-v1-server\` | Its own media route | Shared 16 GB computer hub; private \`user:sham\` session |
| Sham v2 | \`sham-v2-server\` (+ overflow) | Its own image/audio/video Studios | Shared 16 GB computer hub; private \`user:sham_v2\` session |
| Qwen3.5-9B | \`sham-donor-qwen35-9b-test\` | Its own media Studio | Shared 16 GB computer hub; private \`user:qwen35-9b\` session |
| Gemma 4 E4B | \`sham-donor-gemma4-e4b-test\` | Its own media Studio | Shared 16 GB computer hub; private \`user:gemma4-e4b\` session |
| MiniCPM-o 4.5 | \`sham-donor-minicpmo45-test\` | Its own media Studio | Shared 16 GB computer hub; private \`user:minicpmo45\` session |

## The computer host

\`nova-inference-server\` is the private 2-vCPU / 16-GB ModelScope Studio reserved exclusively for execution. The MiniCPM-o 4.5 big-model app was removed from this Studio. Its model download cache is retired; only the exact \`donor-bakeoff/minicpmo45-big/model_cache\` directory is deleted during migration. Candidate inference and media repositories are unchanged.

The host runs no LLM, image, audio or video weights. It provides:
- Persistent Linux terminal, files, repository checkout/search and background jobs.
- Chromium headless browser with separate user+model contexts and cookies.
- Xvfb/Openbox graphical desktop controlled through authenticated Gradio RPCs.
- Private unprivileged UID and home for every user+model key under \`/mnt/workspace/computer\`; browser data lives under \`/mnt/workspace/browser\`.
- Eight-GB per-session workspace quota, a memory watcher, clean terminal environment and no provider credentials passed into shell processes.

### Persistent linked storage banks

Each private `user:model` home now contains a `banks/` directory and its own SQLite catalog on the same persistent ModelScope workspace volume. It is not a Supabase dependency or a separate hosted database. First use creates the logical banks `projects`, `documents`, `datasets`, `assets`, `sessions`, and `tools`; models may create additional named banks without a fixed bank-count limit.

The model-facing `computer_bank` tool can list/create banks, store text entries, import a file already in that session's home into a bank, read entries, search one or all banks, link entries across banks, and inspect bank statistics. Imported files are copied into the bank so their catalog reference is stable. All catalog rows, link edges, and file objects remain under that session's private home and are covered by the existing per-session disk quota. The filesystem and free space are still finite; “no fixed number of banks” does not mean unlimited physical storage. The current default session quota is 8 GB and the host keeps at least 1 GB of free disk as a shared reserve by refusing new writes/imports/downloads that would consume it.

Search currently uses a lightweight local lexical index over titles, descriptions, keys, and indexed text. It does not load an embedding model or claim Palmyra-style vector retrieval. File content remains available through the returned private path and the existing computer file/read/view tools. No new external database service is required.

### Optional applications and developer workbench

The computer-only Studio keeps its small initial bootstrap. Optional applications are installed only when a model asks through the model-facing `computer_apps` tool; installation groups are allowlisted, run in the background, and check actual free disk before starting:

- `office`: LibreOffice Writer, Calc, Impress and Draw.
- `ocr`: Tesseract Arabic + English, OCRmyPDF, qpdf and Poppler tools.
- `data`: JupyterLab, DuckDB, Polars, pandas, Matplotlib and openpyxl, installed under the persistent shared computer-apps tool directory.
- `creative`: Inkscape, GIMP and Audacity.

The install manifest lives on the computer Studio's persistent workspace volume; only groups explicitly requested are restored after a Studio restart. The software binaries are shared by the dedicated computer host (they contain no user documents); each model's notebooks, files, browser context, cookies and projects still live under its own private `user:model` home. Use `desktop action=apps` to inspect actual installed apps. JupyterLab can be launched through `desktop action=launch app=jupyter`; it binds only to loopback on a session-owned port and returns a private URL for that session's headless browser. Arabic scanned PDFs can be processed with `ocrmypdf -l ara+eng --skip-text input.pdf output.pdf`.

The headless browser now supports tab management, upload from the session's own home into page file inputs, saving downloads back into that home, and reading JavaScript console / failed network diagnostics. The local preview exception is deliberately narrow: only a loopback listener whose process runs under the exact session UID is reachable; other private/internal networks and metadata endpoints remain blocked.

The Studio provides two CPU vCPUs with a bounded multi-session scheduler: up to six shell jobs globally (and a per-session job cap of four), guarded by the live free-memory admission gate. The 16 GB app config supports up to five separate graphical desktop slots when total memory is above 12 GB; each new desktop requires at least 3 GB free RAM, while new terminal jobs require at least 2 GB available. `COMPUTER_QUOTA_GB=8` is the per-session workspace disk allowance, not the Studio RAM allocation. Compiler and language runtimes (Node.js, GCC, Go, Java, Rust, Ruby, PHP, etc.) are installed in the extended developer-tool phase and are checked separately from the initial terminal bootstrap. With inference weights removed, the computer is no longer competing with MiniCPM for the Studio's memory.

## Router

\`src/lib/browserComputer.ts\` routes supported model IDs to \`COMPUTER_STUDIO_URL\`, defaulting to the private \`nova-inference-server\` endpoint. The existing session key continues to include both the verified user and selected model. Media generation does not use this endpoint; it remains on the selected model's separate media Studio.

## Verification

The deployment must report \`role=computer-only\`, \`model_loaded=false\` and revision \`computer-hub-16gb-2026-11-03-r4\`. The live smoke test verifies Bash, persistent file read/write, background jobs, an X11 screenshot and Bash while the desktop is running. Chromium has a separate live page-open check after bootstrap.
