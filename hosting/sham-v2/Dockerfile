# Sham v2 as a portable CPU container: the SAME app the sham-v2-server Studio runs (staged by scripts/transplant/stage_sham_v2_studio.py),
# serving the private model repo novaai2026/sham-v2. CPU only, no GPU, nothing paid. Build with hosting/sham-v2/build.sh (it stages the app first).
# Runtime env (names only; values are never baked into the image):
#   MODELSCOPE_API_TOKEN   read access to the private repo novaai2026/sham-v2 (weights are downloaded on first start into /data)
#   SHAM_CODE_SIGNING_KEY  verifies the signed runtime code in the model repo (same value the Studio uses)
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    GRADIO_SERVER_NAME=0.0.0.0 GRADIO_SERVER_PORT=7860 \
    MODELSCOPE_CACHE=/data/modelscope HOME=/data/home \
    SHAM_MS_MODEL=novaai2026/sham-v2
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 libgomp1 git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY app/requirements.txt /app/requirements.txt
# CPU wheels of torch (no CUDA download), then the Studio's own requirements
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && grep -v '^torch$' requirements.txt > req.txt && pip install -r req.txt
COPY app/ /app/
RUN useradd -m -u 1000 sham && mkdir -p /data && chown -R sham /data /app
USER sham
VOLUME ["/data"]
EXPOSE 7860
HEALTHCHECK --interval=60s --timeout=20s --start-period=1800s CMD curl -fsS http://127.0.0.1:7860/ >/dev/null || exit 1
CMD ["python", "app.py"]
