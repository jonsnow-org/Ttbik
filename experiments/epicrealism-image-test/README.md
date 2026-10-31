# epiCRealism private image test

A separate image-generation Studio for the Nova AI model-selection entry only. It loads `emilianJR/epiCRealism` from the private ModelScope mirror `novaai2026/epicrealism-image-test-models`, verifies every included file against a SHA-256 manifest, and runs on the exact free `platform/2v-cpu-8g-mem` CPU profile. No GPU, 16GB, shared model weights, or automatic fallback.

The model card declares CreativeML OpenRAIL-M. The separate upstream Diffusers safety-checker component is omitted from this image pipeline; platform-level protections against sexualized minors and non-consensual intimate imagery remain active. This is a distinct photorealism candidate, not a claim of unrestricted generation.
