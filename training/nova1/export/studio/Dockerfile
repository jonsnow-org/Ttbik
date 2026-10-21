# ModelScope Studio (Docker type) serving Nova 1 with llama.cpp's OpenAI-compatible server on the Studio port.
FROM ghcr.io/ggml-org/llama.cpp:server
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip && pip3 install --break-system-packages -q modelscope && rm -rf /var/lib/apt/lists/*
COPY start.sh /start.sh
ENTRYPOINT ["bash", "/start.sh"]
