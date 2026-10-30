# Pinned llama-cpp-python MTMD server source

- Upstream: https://github.com/abetlen/llama-cpp-python
- Upstream commit: `1652066e0af45f2313b339670ef9555e8a54e545`
- Original path: `examples/server/server.py`
- Git blob SHA-1: `70a4a6e04d3e2efc292f52e86904c970598356b8`
- License: MIT; see [LICENSE.md](LICENSE.md).

The donor Studio validates the source blob SHA-1 before applying its three small runtime patches (projector capability reporting, native thinking-template variable, and Qwen tool-argument history typing). This pinned copy removes the network fetch from the Studio cold-start path.
