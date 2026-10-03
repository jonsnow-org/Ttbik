FROM python:3.12-slim

# ffmpeg is required for audio extraction and merging
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# JavaScript runtime: YouTube's player challenge can only be solved with one (yt-dlp-ejs + deno).
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render sets PORT; Telegram's webhook POSTs arrive on it (see main.py)
CMD ["python", "main.py"]
