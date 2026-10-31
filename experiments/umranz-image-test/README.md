# Umranz private image test

A standalone, CPU-only Gradio application for `Umranz/SD1.5-Uncensored-Photoreal`. Its weights, cache, process, dependencies, API and results are exclusive to this Studio. Target hardware: ModelScope CPU 8GB RAM only; no GPU or 16GB fallback.

The app uses its own Diffusers pipeline and exposes only `/status` and `/image`. It does not import CyberRealistic or Juggernaut code, weights or tools. Production Nova/Sham/Sham v2 routes are not referenced.


Latest validation update (2026-10-31): Gradio status payload parsing now handles nested JSON and exposes the real loader phase, traceback, checkpoint hash and memory telemetry. This rerun is a diagnosis of the existing Umranz assignment for MiniCPM-o 4.5; it does not change or substitute the model.


Diagnostic rerun note: the previous CI attempt stopped at a malformed workflow heredoc before loading weights. The heredoc is now repaired; next run will capture loader phase, traceback, exact checkpoint repository/hash and memory telemetry.

Workflow parser fix 2: the Python heredoc terminator is now aligned exactly with its Bash opener, after a prior indentation regression. Next deployment run verifies the workflow itself before weight loading.
