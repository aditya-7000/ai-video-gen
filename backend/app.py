import os
import time
import uuid
import json
import shutil
import threading
import subprocess
import re
from pathlib import Path
from datetime import timedelta
from typing import Dict, Any, Optional

from dotenv import load_dotenv
from flask import Flask, request, jsonify, abort, send_from_directory
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix

# Google GenAI client
from google import genai
from google.genai import types

# Google Cloud Storage
from google.cloud import storage

# OpenAI for prompt improvement
import openai
from flask_cors import CORS

from pymongo import MongoClient
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# -----------------------
# Config & Initialization
# -----------------------
load_dotenv()

# Google GenAI
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")


# GCS
GCS_BUCKET = os.getenv("GCS_BUCKET_NAME")
if not GCS_BUCKET:
    raise RuntimeError("Please set GCS_BUCKET_NAME in your environment or .env file")

GCS_PUBLIC = (os.getenv("GCS_PUBLIC", "false").lower() in ("1", "true", "yes"))
SIGNED_URL_TTL_MIN = int(os.getenv("SIGNED_URL_TTL_MIN", "60"))

# Model for video generation
MODEL_NAME = os.getenv("MODEL_NAME", "veo-2.0-generate-001")

# ffmpeg
FFMPEG_BIN = os.getenv("FFMPEG_BIN", "ffmpeg")

# OpenAI for prompt improvement (GPT-3.5)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    # Prompt endpoints will return an error if this is missing — we allow the rest of the service to run.
    print("Warning: OPENAI_API_KEY not set — /api/improve and /api/compose will fail until set.")
else:
    openai.api_key = OPENAI_API_KEY

# Paths
BASE_DIR = Path(__file__).parent.resolve()
VIDEO_DIR = BASE_DIR / "videos"
VIDEO_DIR.mkdir(exist_ok=True, parents=True)
HLS_DIR = BASE_DIR / "hls"
HLS_DIR.mkdir(exist_ok=True, parents=True)

# Clients
genai_client = genai.Client(api_key=GOOGLE_API_KEY)
storage_client = storage.Client()
MONGO_URI = os.getenv("MONGODB_URI")
MONGO_DB = os.getenv("MONGODB_DB")
mongo_client = MongoClient(MONGO_URI)
db = mongo_client[MONGO_DB]
videos_col = db["videos"]

app = Flask(__name__)

# Respect reverse-proxy headers in production (X-Forwarded-For/Proto)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

# -----------------------
# Rate Limiting (per-IP)
# -----------------------
# Default: 100/hour per IP; in-memory storage (sufficient for single-instance)
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri="memory://",
)
limiter.init_app(app)

@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({"error": "Too many requests", "details": str(getattr(e, "description", "rate limit exceeded"))}), 429

# CORS configuration: allow specific origins in production via CORS_ORIGINS
cors_origins = os.getenv("CORS_ORIGINS")
if cors_origins:
    origins_list = [o.strip() for o in cors_origins.split(",") if o.strip()]
    CORS(app, origins=origins_list, supports_credentials=True)
else:
    # Default permissive CORS for local/dev
    CORS(app)
app.config["VIDEO_DIR"] = str(VIDEO_DIR)
app.config["HLS_DIR"] = str(HLS_DIR)

# -----------------------
# In-memory Job Store
# -----------------------
JOBS: Dict[str, Dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()

def make_job(prompt: str, negative_prompt: Optional[str], prompt_source: Optional[str]) -> str:
    job_id = uuid.uuid4().hex
    job_doc = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "prompt_source": prompt_source or "user_prompt",
        "error": None,
        "mp4_gcs_path": None,
        "mp4_url": None,
        "local_mp4": None,
        "hls_url": None,
        "created_at": time.time(),
    }
    try:
        videos_col.insert_one(job_doc)
        print(f"[make_job] Job created: {job_id}")
    except Exception as e:
        print(f"[make_job][ERROR] Failed to insert job {job_id}: {e}")
    return job_id

def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    try:
        job = videos_col.find_one({"job_id": job_id})
        print(f"[get_job] Fetched job {job_id}: {bool(job)}")
        return job
    except Exception as e:
        print(f"[get_job][ERROR] Failed to fetch job {job_id}: {e}")
        return None

def update_job(job_id: str, **kwargs):
    try:
        result = videos_col.update_one({"job_id": job_id}, {"$set": kwargs})
        print(f"[update_job] Updated job {job_id} with {kwargs}. Matched: {result.matched_count}, Modified: {result.modified_count}")
        if result.matched_count == 0:
            print(f"[update_job][WARN] No job found with job_id {job_id}")
    except Exception as e:
        print(f"[update_job][ERROR] Failed to update job {job_id}: {e}")

# -----------------------
# GCS Helpers
# -----------------------
def gcs_blob(bucket_name: str, object_name: str):
    bucket = storage_client.bucket(bucket_name)
    return bucket.blob(object_name)

def gcs_public_url(bucket_name: str, object_name: str) -> str:
    return f"https://storage.googleapis.com/{bucket_name}/{object_name}"

def gcs_signed_url(bucket_name: str, object_name: str, ttl_min: int, method: str = "GET") -> str:
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(object_name)
    return blob.generate_signed_url(
        version="v4",
        expiration=timedelta(minutes=ttl_min),
        method=method,
    )

def upload_file_to_gcs(local_path: Path, object_name: str, content_type: str) -> str:
    blob = gcs_blob(GCS_BUCKET, object_name)
    blob.upload_from_filename(str(local_path), content_type=content_type)
    blob.cache_control = "public, max-age=31536000, immutable"
    blob.patch()
    if GCS_PUBLIC:
        return gcs_public_url(GCS_BUCKET, object_name)
    else:
        return gcs_signed_url(GCS_BUCKET, object_name, SIGNED_URL_TTL_MIN, method="GET")

def upload_directory_to_gcs(local_dir: Path, prefix: str, content_type_map: Dict[str, str]):
    uploaded = []
    for root, _, files in os.walk(local_dir):
        for fname in files:
            fpath = Path(root) / fname
            rel = fpath.relative_to(local_dir)
            object_name = f"{prefix}/{rel.as_posix()}"
            ext = fpath.suffix.lower()
            ctype = content_type_map.get(ext, "application/octet-stream")
            blob = gcs_blob(GCS_BUCKET, object_name)
            blob.upload_from_filename(str(fpath), content_type=ctype)
            blob.cache_control = "public, max-age=31536000, immutable"
            blob.patch()
            uploaded.append(object_name)
    return uploaded

# HLS packaging
def package_hls(local_mp4: Path, hls_dir: Path):
    hls_name = local_mp4.stem
    hls_path = hls_dir / hls_name
    hls_path.mkdir(exist_ok=True, parents=True)
    cmd = [
        FFMPEG_BIN,
        "-i", str(local_mp4),
        "-c:v", "libx264",
        "-c:a", "aac",
        "-f", "hls",
        "-hls_time", "2",
        "-hls_list_size", "0",
        "-hls_segment_filename", str(hls_path / "%03d.ts"),
        str(hls_path / "index.m3u8"),
    ]
    subprocess.run(cmd, check=True)
    return hls_path

def upload_hls_to_gcs(hls_dir: Path, hls_object: str):
    content_type_map = {
        ".ts": "video/MP2T",
        ".m3u8": "application/x-mpegURL",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".vtt": "text/vtt",
    }
    upload_directory_to_gcs(hls_dir, hls_object, content_type_map)
    # Note: Signed URLs are impractical for HLS segments; require public bucket for HLS
    return gcs_public_url(GCS_BUCKET, f"{hls_object}/index.m3u8")

def _format_ts(seconds: float) -> str:
    ms = int(round((seconds - int(seconds)) * 1000))
    total = int(seconds)
    h = total // 3600
    m = (total % 3600) // 60
    s = total % 60
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"

def generate_thumbnails_per_image(local_mp4: Path, thumbs_dir: Path, fps: int = 1, width: int = 160) -> Path:
    thumbs_dir.mkdir(exist_ok=True, parents=True)
    # Generate JPEG thumbnails at 1 fps
    out_pattern = thumbs_dir / "thumb-%04d.jpg"
    cmd = [
        FFMPEG_BIN,
        "-i", str(local_mp4),
        "-vf", f"fps={fps},scale={width}:-1",
        "-q:v", "3",
        str(out_pattern),
    ]
    subprocess.run(cmd, check=True)

    # Build a simple VTT with 1s cues mapping to each image
    images = sorted([p for p in thumbs_dir.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".webp")])
    vtt_path = thumbs_dir / "thumbs.vtt"
    with open(vtt_path, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for i, img in enumerate(images):
            start = _format_ts(i * (1.0 / fps))
            end = _format_ts((i + 1) * (1.0 / fps))
            # Reference image by filename relative to VTT file location
            f.write(f"{start} --> {end}\n")
            f.write(f"{img.name}\n\n")
    return vtt_path

# -----------------------
# Background Job Worker
# -----------------------
def generate_video_job(job_id: str):
    job = get_job(job_id)
    if not job:
        return

    prompt = job["prompt"]
    negative_prompt = job["negative_prompt"]

    filename_base = secure_filename(prompt)[:40] or "video"
    safe_uid = job_id[:8]
    mp4_name = f"{filename_base}-{safe_uid}.mp4"
    local_mp4 = VIDEO_DIR / mp4_name
    mp4_object = f"videos/{mp4_name}"

    try:
        update_job(job_id, status="running", progress=5)

        operation = genai_client.models.generate_videos(
            model=MODEL_NAME,
            prompt=prompt,
            config=types.GenerateVideosConfig(
                person_generation="allow_adult",
                aspect_ratio="16:9",
                duration_seconds=6,
                negative_prompt=negative_prompt,
            ),
        )

        prog = 5
        while not operation.done:
            time.sleep(5)
            prog = min(prog + 10, 70)
            update_job(job_id, progress=prog)
            operation = genai_client.operations.get(operation)

        if getattr(operation, "error", None):
            raise RuntimeError(str(operation.error))

        generated_videos = operation.result.generated_videos
        if not generated_videos:
            raise RuntimeError("No videos returned by model")

        generated_video = generated_videos[0]

        genai_client.files.download(file=generated_video.video)
        try:
            generated_video.video.save(str(local_mp4))
        except AttributeError:
            content = getattr(generated_video.video, "content", None)
            if content is None:
                raise RuntimeError("SDK returned unexpected video object; cannot save")
            with open(local_mp4, "wb") as f:
                f.write(content)

        update_job(job_id, progress=80, local_mp4=str(local_mp4))

        mp4_url = upload_file_to_gcs(local_mp4, mp4_object, content_type="video/mp4")
        update_job(job_id, progress=88, mp4_url=mp4_url, mp4_gcs_path=mp4_object)

        # Try to produce HLS and thumbnails, but do not fail the job if it errors
        try:
            hls_dir = HLS_DIR / safe_uid
            packaged_dir = package_hls(local_mp4, hls_dir)
            # Generate per-image thumbnails + VTT under packaged_dir/thumbs
            thumbs_dir = packaged_dir / "thumbs"
            vtt_path = generate_thumbnails_per_image(local_mp4, thumbs_dir, fps=1, width=160)

            # Compute common relative dir for local and GCS (include stem)
            rel_dir = f"{safe_uid}/{local_mp4.stem}"

            if GCS_PUBLIC:
                # Upload entire packaged_dir (HLS + thumbs) under hls/<safe_uid>/<stem>
                hls_object = f"hls/{rel_dir}"
                hls_url = upload_hls_to_gcs(packaged_dir, hls_object)
                thumb_vtt_url = gcs_public_url(GCS_BUCKET, f"{hls_object}/thumbs/{vtt_path.name}")
            else:
                # Serve locally when bucket is private
                hls_url = f"/hls/{rel_dir}/index.m3u8"
                thumb_vtt_url = f"/hls/{rel_dir}/thumbs/{vtt_path.name}"
            update_job(job_id, hls_url=hls_url, thumb_vtt_url=thumb_vtt_url)
        except Exception as e_hls:
            print(f"[HLS][WARN] Failed to package/upload HLS for {job_id}: {e_hls}")

        update_job(job_id, status="done", progress=100)

    except Exception as e:
        update_job(job_id, status="error", error=str(e))

# -----------------------
# Prompt Improvement Helpers (OpenAI GPT-3.5)
# -----------------------
def safe_parse_json_from_text(text: str):
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except Exception:
            return None

@app.route("/api/improve", methods=["POST"])
@limiter.limit("10 per minute")
def api_improve():
    """
    POST { prompt: "..." }
    Returns JSON:
    {
      "auto_improved": "<full improved prompt>",
      "variants": [
        {"concise": "short idea", "expanded": "<full prompt>"},
        ...
      ]
    }

    
    """
    if not OPENAI_API_KEY:
        return jsonify({"error": "OPENAI_API_KEY not configured on server"}), 500

    data = request.get_json(force=True, silent=True) or {}
    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "Missing 'prompt'"}), 400

    # System instruction updated to request concise+expanded variants
    system = (
"You are a professional prompt engineer and creative director for short cinematic videos. "
"Given a short user prompt, do two things:\n\n"
"1) Produce 'auto_improved' — a polished, generation-ready full and detailed prompt suitable for text-to-video models. "
"Make the auto_improved prompt vivid and self-contained: include shot type , camera movement and angle, framing, descriptive atmosphere (mood, weather, time of day), lighting mood and color grading, motion style (slow motion/real-time/tracking), and an optional sound cue or reference style (documentary, commercial, nostalgic, whimsical). "
"When appropriate, add tasteful, scene-appropriate special effects (dirt, sparks, light flares, dust motes) to enhance the action; avoid prescribing technical specs for those effects. "
"Keep it concise (about 1–3 sentences) and ready to paste into a generator.\n\n"
"2) Produce EXACTLY 4 'variants'. Each variant must be an OBJECT with two fields:\n"
" - 'concise': an extra short creative idea suitable for showing in a quick list on the frontend.\n"
" - 'expanded': a full, polished prompt (like auto_improved) that incorporates the concise idea in cinematic detail.\n\n"
"Variant content guidance (IMPORTANT):\n"
"- Variants should be unique and MUST prioritize scene content: actors, actions, props, interactions, animals, or environmental elements (examples: owner throws frisbee, dog chases butterfly, two dogs play tug, retriever rolls in wildflowers). "
"- DO NOT output pure technical/stylistic effects (for example: 'drone angle', 'slow motion', 'pan', 'color grade') as the 'concise' idea. Technical effects are NOT valid standalone variants. "
"- Technical or stylistic elements may appear in 'expanded' only when they directly enhance the scene action (for example: 'leaping mid-air in slow motion' or 'wide shot from low angle as they run'). "
"- If an idea is primarily a camera/effect idea, convert it into a content-focused variant (e.g., prefer 'frisbee catch mid-air' over 'slow motion').\n\n"
"Creative choices guidance (when the user prompt lacks specifics):\n"
"- Make confident, tasteful creative decisions rather than asking for clarification. Choose a clear cinematic tone (documentary, commercial, nostalgic, or whimsical), an appropriate shot scale (close-up/medium/wide), and a simple camera movement (dolly, pan, handheld, or static). "
"- Suggest broad stylistic elements such as lighting mood (warm sunrise / soft overcast / golden hour), general color grading (warm, cool, or neutral), motion style (slow motion, real-time, or gentle tracking), and an optional sound cue (wind, laughter, distant music) without prescribing technical camera settings. "
"- Avoid overly specific technical specs (exact focal lengths, frame rates, or codec choices); keep choices evocative and flexible so they can be adapted by different generators.\n\n"
"Requirements and strict rules (must obey precisely):\n"
"- Return ONLY a single valid JSON object with two keys: 'auto_improved' (string) and 'variants' (array of exactly 4 objects). Nothing else. No commentary, no markdown, no code fences. "
"- Each 'variants' object must contain exactly the fields 'concise' and 'expanded'. No extra fields. The array length must be exactly 4. "
"- 'concise' must be short and snappy (roughly 4–8 words) and describe scene content (actors/actions/props/environment). Do not place camera/effect-only phrases in 'concise'. "
"- 'expanded' must be a complete, vivid prompt ready to send to a video generation model, approximately the same length and level of detail as 'auto_improved'. It's allowed to include tasteful stylistic touches tied to the content. "
"- Order 'variants' from broadly accessible/conventional to more experimental/expressive. "
"- If the user prompt lacks specifics, make confident creative choices; do not ask clarifying questions. "
"- Do not include placeholders like <PROMPT> or metadata. Do not include comments or explanations. "
"- Produce outputs that are cinematic, actionable, and immediately usable by a text-to-video model.\n"
)
    
    user_msg = f"User prompt: \"{prompt}\""

    try:
        resp = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.7,
            max_tokens=400,
        )
        text = resp["choices"][0]["message"]["content"]
        parsed = safe_parse_json_from_text(text)

        # Validate shape
        if not parsed:
            return jsonify({"error": "Model returned unparsable response", "raw": text}), 500

        ai = parsed.get("auto_improved")
        variants = parsed.get("variants")
        if not ai or not isinstance(ai, str):
            return jsonify({"error": "Missing 'auto_improved' in model response", "raw": text}), 500
        if not variants or not isinstance(variants, list) or len(variants) != 4:
            return jsonify({"error": "Expected exactly 4 variants (array) in response", "raw": text}), 500

        # Validate each variant object (no strict concise-length checks)
        normalized_variants = []
        for i, v in enumerate(variants):
            if not isinstance(v, dict):
                return jsonify({"error": f"Variant #{i+1} is not an object", "raw": text}), 500
            concise = v.get("concise")
            expanded = v.get("expanded")
            if not concise or not isinstance(concise, str):
                return jsonify({"error": f"Variant #{i+1} missing 'concise' (string)", "raw": text}), 500
            if not expanded or not isinstance(expanded, str):
                return jsonify({"error": f"Variant #{i+1} missing 'expanded' (string)", "raw": text}), 500
            normalized_variants.append({"concise": concise.strip(), "expanded": expanded.strip()})

        return jsonify({"auto_improved": ai.strip(), "variants": normalized_variants}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/compose", methods=["POST"])
@limiter.limit("10 per minute")
def api_compose():
    """
    POST { base_improved: "...", variant: "...", mode: "merge"|"auto_refine" }
    Returns { composed: "final prompt" }
    """
    if not OPENAI_API_KEY:
        return jsonify({"error": "OPENAI_API_KEY not configured on server"}), 500

    data = request.get_json(force=True, silent=True) or {}
    variant = (data.get("variant") or "").strip()
    base_improved = (data.get("base_improved") or "").strip()
    mode = (data.get("mode") or "auto_refine").strip()

    if not variant:
        return jsonify({"error": "Missing 'variant'"}), 400
    if mode not in ("merge", "auto_refine"):
        return jsonify({"error": "Invalid mode; must be 'merge' or 'auto_refine'"}), 400
    if mode == "merge" and not base_improved:
        return jsonify({"error": "mode 'merge' requires base_improved field"}), 400

    try:
        if mode == "merge":
            combined = f"{base_improved.rstrip('. ')}. {variant.strip()}"
            system = (
                "You are a concise prompt polisher for text-to-video. Polishing must keep all details, "
                "improve wording for clarity and cinematic descriptiveness, and return only the polished prompt as plain text."
            )
            user = f"Polish this prompt to be concise and cinematic:\n\n{combined}"
            resp = openai.ChatCompletion.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.6,
                max_tokens=200,
            )
            out = resp["choices"][0]["message"]["content"].strip()
            return jsonify({"composed": out}), 200

        else:
            system = (
                "You are a professional prompt engineer. Given an improved base prompt (may be empty) and a single variant detail, "
                "produce one polished, cinematic, generation-ready prompt that combines them clearly. Return only the final prompt as plain text."
            )
            user = f"Base improved prompt:\n{base_improved}\n\nVariant detail:\n{variant}\n\nCombine and produce a single polished prompt."
            resp = openai.ChatCompletion.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.6,
                max_tokens=220,
            )
            out = resp["choices"][0]["message"]["content"].strip()
            return jsonify({"composed": out}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -----------------------
# Video generation endpoints (unchanged, but accepts composed_prompt)
# -----------------------
@app.route("/api/generate", methods=["POST"])
@limiter.limit("2 per minute; 1 per 5 seconds")
def api_generate():
    """
    Start a non-blocking generation job.
    Body: { "prompt": "...", "composed_prompt": "...", "negative_prompt": "..." }
    Returns: { "job_id": "..." }
    """
    data = request.get_json(force=True, silent=True) or {}
    raw_prompt = (data.get("prompt") or "").strip()
    composed_prompt = (data.get("composed_prompt") or "").strip()
    negative_prompt = data.get("negative_prompt")

    # Prefer composed_prompt if present
    prompt_to_use = composed_prompt or raw_prompt
    if not prompt_to_use:
        return jsonify({"error": "Missing 'prompt' or 'composed_prompt'"}), 400

    prompt_source = "composed_prompt" if composed_prompt else "user_prompt"

    job_id = make_job(prompt_to_use, negative_prompt, prompt_source)
    t = threading.Thread(target=generate_video_job, args=(job_id,), daemon=True)
    t.start()
    return jsonify({"job_id": job_id}), 202

@app.route("/api/status/<job_id>", methods=["GET"])
@limiter.limit("60 per minute")
def api_status(job_id: str):
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "job not found"}), 404
    fields = [
        "id", "status", "progress", "prompt", "prompt_source", "error",
        "mp4_url", "mp4_gcs_path", "hls_url", "thumb_vtt_url", "created_at"
    ]
    return jsonify({k: job.get(k) for k in fields})

@app.route("/api/videos", methods=["GET"])
@limiter.limit("30 per minute")
def api_list_videos():
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 20))
    total = videos_col.count_documents({})
    cursor = videos_col.find().sort("created_at", -1).skip((page - 1) * per_page).limit(per_page)
    items = []
    for v in cursor:
        items.append({
            "id": v.get("job_id"),
            "prompt": v.get("prompt"),
            "status": v.get("status"),
            "progress": v.get("progress"),
            "mp4_url": v.get("mp4_url"),
            "hls_url": v.get("hls_url"),
            "thumb_vtt_url": v.get("thumb_vtt_url"),
            "created_at": v.get("created_at"),
            "error": v.get("error")
        })
    return jsonify({
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": items
    })

@app.route("/api/videos/<string:video_id>", methods=["GET"])
def api_get_video(video_id):
    try:
        v = videos_col.find_one({"job_id": video_id})
    except Exception as e:
        return jsonify({"error": f"db error: {e}"}), 500
    if not v:
        return jsonify({"error": "not found"}), 404
    return jsonify({
        "id": v.get("job_id"),
        "prompt": v.get("prompt"),
        "status": v.get("status"),
        "progress": v.get("progress"),
        "mp4_url": v.get("mp4_url"),
        "hls_url": v.get("hls_url"),
        "thumb_vtt_url": v.get("thumb_vtt_url"),
        "created_at": v.get("created_at"),
        "error": v.get("error")
    })

# local fallback
@app.route("/videos/<path:filename>")
@limiter.exempt
def serve_video(filename):
    safe_name = secure_filename(filename)
    fp = Path(app.config["VIDEO_DIR"]) / safe_name
    if not fp.exists():
        abort(404)
    return send_from_directory(app.config["VIDEO_DIR"], safe_name, as_attachment=False)

@app.route("/hls/<path:filename>")
@limiter.exempt
def serve_hls(filename):
    base = Path(app.config["HLS_DIR"]).resolve()
    fp = (base / filename).resolve()
    # Prevent path traversal
    if not str(fp).startswith(str(base)) or not fp.exists():
        abort(404)
    return send_from_directory(str(fp.parent), fp.name, as_attachment=False)

@app.route("/")
@limiter.exempt
def health():
    return jsonify({"ok": True})

# Additional health endpoints commonly used by cloud platforms
@app.route("/healthz")
@app.route("/api/health")
@limiter.exempt
def healthz():
    return jsonify({"status": "healthy"})

if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=debug)
