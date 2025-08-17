# AI Video Generator App

A full‑stack web app for generating short cinematic videos from text prompts.

- Frontend: React + Vite + Mantine UI, HLS playback with `hls.js`
- Backend: Flask API, Google GenAI (Veo 2) video generation, Google Cloud Storage (GCS), MongoDB for job metadata, OpenAI for prompt improvement
  
Live Demo: https://stalwart-cranachan-44f836.netlify.app ,
API Base: https://ai-video-backend-723866435939.asia-south1.run.app
Key paths:
- Frontend: `frontend/`
- Backend: `backend/app.py`

## Features
- Uses Google's Veo 2 model (`veo-2.0-generate-001`) for generation
- Prompt enhancement using OpenAI (`/api/improve`, `/api/compose`)
- Start video generation and poll job status (`/api/generate`, `/api/status/:id`)
- Stores outputs in GCS (public or signed URLs)
- HLS packaging and thumbnail previews (public buckets recommended)
- History list with preview, timestamp, and MP4 download
- Basic server-side rate limiting on sensitive endpoints to mitigate abuse

## Prerequisites
- Node 18+ and npm
- Python 3.11+
- A GCS bucket (preferably public for HLS)
- MongoDB cluster/URI
- API keys: Google GenAI, OpenAI

## Environment Variables

Backend `.env` (see `backend/.env.example`):
- FLASK_DEBUG=false
- PORT=8080
- CORS_ORIGINS=https://your-frontend.netlify.app,https://your-domain.com
- GOOGLE_API_KEY=...
- MODEL_NAME=veo-2.0-generate-001
- FFMPEG_BIN=ffmpeg
- GCS_BUCKET_NAME=your-bucket
- GCS_PUBLIC=true
- SIGNED_URL_TTL_MIN=60
- OPENAI_API_KEY=...
- MONGODB_URI=mongodb+srv://...
- MONGODB_DB=video_app

Frontend `.env` (see `frontend/.env.example`):
- VITE_API_BASE=https://your-backend.example.com

Note: The frontend will call the backend at `VITE_API_BASE`. Do not leave it empty in production.

## Local Development

Backend:
1. Create and fill `backend/.env` from `backend/.env.example`
2. Install deps: `pip install -r backend/requirements.txt`
3. Run: `python backend/app.py` (or `flask run` if set up). Defaults to port 5000.

Frontend:
1. Create `frontend/.env` from `frontend/.env.example`
2. Set `VITE_API_BASE=http://localhost:5000`
3. Install deps: `npm i` (inside `frontend/`)
4. Run dev server: `npm run dev`

## Production Build & Deploy

### Backend (Docker + Gunicorn + FFmpeg)
Dockerfile: `backend/Dockerfile`
- Installs `ffmpeg`
- Runs `gunicorn app:app -b 0.0.0.0:8080`

Build locally:
```bash
# from repo root
docker build -t ai-video-backend ./backend
```

Run locally:
```bash
docker run --rm -p 8080:8080 \
  --env-file backend/.env \
  ai-video-backend
```

#### Deploy to Cloud Run (example)
```bash
# Build & push
gcloud builds submit --tag gcr.io/PROJECT_ID/ai-video-backend ./backend

# Deploy
gcloud run deploy ai-video-backend \
  --image gcr.io/PROJECT_ID/ai-video-backend \
  --platform managed \
  --region YOUR_REGION \
  --allow-unauthenticated \
  --set-env-vars PORT=8080,FLASK_DEBUG=false,CORS_ORIGINS="https://your-frontend.netlify.app,https://your-domain.com" \
  --set-env-vars GOOGLE_API_KEY=***,OPENAI_API_KEY=***,GCS_BUCKET_NAME=***,GCS_PUBLIC=true,SIGNED_URL_TTL_MIN=60 \
  --set-env-vars MONGODB_URI=***,MONGODB_DB=video_app
```

Alternatively, deploy to Render/Railway/Docker-compatible hosts using the same image. Ensure `PORT` is set.

### Frontend (Netlify)
Config file: `frontend/netlify.toml`
- Build command: `vite build`
- Publish dir: `dist`
- SPA redirect for client routes

Steps:
1. In Netlify Site Settings → Environment, set `VITE_API_BASE=https://<your-backend-domain>`
2. Trigger deploy; or connect the repo and let Netlify build from `frontend/`
3. Confirm that API calls are going to your backend domain

Important: If your frontend ever makes relative calls to `/api/*`, Netlify may proxy them to Functions due to a default redirect. This project uses absolute `VITE_API_BASE`, so ensure it is set to avoid misrouting.

## Google Cloud Storage Setup
For smooth HLS playback, use a public bucket.
- Enable Uniform bucket-level access
- Disable Public access prevention
- Grant `allUsers` the role `Storage Object Viewer`
- Optional CORS on bucket (JSON):
```json
[
  {
    "origin": ["https://your-frontend.netlify.app", "https://your-domain.com"],
    "method": ["GET", "HEAD", "OPTIONS"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```
- Recommended Cache-Control for objects: `public, max-age=31536000, immutable`

If `GCS_PUBLIC=false`, the backend uses signed URLs for MP4, and serves HLS locally via `/hls/*` endpoints (less ideal for cloud hosting).

## CORS
Set `CORS_ORIGINS` in the backend environment to the exact frontend origins, comma-separated.

## Authentication
The app currently uses a dummy login. The `Header` component (`frontend/src/components/Header.jsx`) only shows Generate/History links when logged in.

## Troubleshooting
- 403 from GCS: verify bucket is public and object ACLs/inheritance, or use signed URLs
- CORS error: set correct `CORS_ORIGINS` and GCS CORS
- `/api/improve` returns 500: ensure `OPENAI_API_KEY` is set
- Polling shows non-JSON: ensure backend is reachable and `VITE_API_BASE` is configured on the frontend
- FFmpeg not found: confirm image contains `ffmpeg` (Dockerfile installs it)

## GitHub
Typical flow from repo root:
```bash
git init
git add .
git commit -m "Initial deployable app"
# Create repo on GitHub and add remote
# git remote add origin https://github.com/<user>/<repo>.git
# git push -u origin main
```
