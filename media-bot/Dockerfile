FROM python:3.12-slim

# ffmpeg is required for audio extraction and merging
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render sets PORT; we use polling so no need to expose HTTP
CMD ["python", "main.py"]
