# Juggernaut XL Ragnarok FP8 private image test

A standalone CPU-only Gradio app for the exact FP8 e4m3fn checkpoint in `Kandoo/Juggernaut-XL-Ragnarok`. It owns its cache, process, dependencies, endpoint and outputs. Target: ModelScope CPU 8GB only. The app uses 512x512, 20 steps and FP16 CPU compute to attempt a controlled 8GB load. It never chooses a GPU or 16GB memory tier. If the FP8 checkpoint cannot load or generate within the cap, it reports a failure rather than migrating to another machine or model.

This app does not import or share Umranz or CyberRealistic runtime code or weights. Production Nova/Sham/Sham v2 routes are not referenced.
