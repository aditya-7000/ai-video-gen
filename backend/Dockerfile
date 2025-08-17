# Backend Dockerfile for production (Flask + Gunicorn + FFmpeg)
# Uses a slim Python base image and installs ffmpeg from apt

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Install ffmpeg and minimal build deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first to leverage Docker layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py ./

# Default port used by many PaaS providers (Cloud Run sets PORT at runtime)
ENV PORT=8080
EXPOSE 8080

# Gunicorn config: 2 workers, 4 threads each; adjust for your CPU/memory
# If deploying behind a proxy, we already enabled ProxyFix in app.py
CMD ["gunicorn", "-b", "0.0.0.0:8080", "app:app", "--workers=2", "--threads=4", "--timeout=180"]
