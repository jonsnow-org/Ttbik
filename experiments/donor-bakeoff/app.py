"""CPU-only, isolated donor bake-off with direct text/vision/audio/video input.

The app starts a pinned llama-cpp-python MTMD server as a local child process.
All candidate traffic stays inside this private Studio. It has no connection
to production models, Nova, external media-generation providers, private
connector credentials, or write operations. Its two optional tools are public
read-only checks: a public GitHub repository-root listing and an HTTP
reachability probe of ttbik.vercel.app (not Vercel deployment-control-plane data).
"""
from __future__ import annotations

import atexit
import hashlib
import base64
import json
import mimetypes
import os
import re
import subprocess
import threading
import uuid
import time
import wave
from pathlib import Path, PurePosixPath

import gradio as gr
import requests
from huggingface_hub import hf_hub_download
from tool_parsing import parse_tool_calls, strip_tool_call_markup

CONFIG_PATH = Path(__file__).with_name("candidate.json")
CONFIG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
APP_REVISION = "donor-bakeoff-2026-10-30-r8"
ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "model_cache"
RUNTIME = Path(os.environ.get("DONOR_RUNTIME_DIR", "/tmp/donor-bakeoff-runtime"))
RUNTIME.mkdir(parents=True, exist_ok=True)

SERVER_PORT = int(os.environ.get("DONOR_MODEL_PORT", "7861"))
SERVER_BASE = f"http://127.0.0.1:{SERVER_PORT}"
VENDORED_SERVER_SOURCE = ROOT / "vendor" / "llama_cpp_server.py"
SERVER_SOURCE_SHA = "70a4a6e04d3e2efc292f52e86904c970598356b8"
SERVER_SCRIPT = RUNTIME / "llama_cpp_server.py"
SERVER_CONFIG = RUNTIME / "server-config.json"
SERVER_LOG = RUNTIME / "llama-server.log"
MEDIA_CAPS_FILE = RUNTIME / "media-capabilities.json"

THREADS = max(1, min(int(os.cpu_count() or 2), 2))
N_CTX = int(os.environ.get("DONOR_N_CTX", CONFIG.get("context_tokens", 2048)))
MAX_OUTPUT = int(os.environ.get("DONOR_MAX_OUTPUT", CONFIG.get("max_output_tokens", 768)))
IMAGE_MAX_BYTES = 20 * 1024 * 1024
AUDIO_MAX_BYTES = 24 * 1024 * 1024
VIDEO_MAX_BYTES = 32 * 1024 * 1024

STATE = {
    "phase": "loading",
    "error": None,
    "model_path": None,
    "mmproj_path": None,
    "server_pid": None,
    "server_process": None,
    "load_seconds": None,
    "started_at": time.time(),
    "candidate": CONFIG.get("label", CONFIG.get("id", "unknown")),
    "media": {"vision": False, "audio": False, "video": False},
}
LOCK = threading.RLock()

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "github_repo_scan",
            "description": "Read-only scan of a GitHub repository root and return its real file listing. Use when the user asks to inspect a named GitHub repository.",
            "parameters": {
                "type": "object",
                "properties": {"repo": {"type": "string", "description": "GitHub repository in owner/name form"}},
                "required": ["repo"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_read_files",
            "description": "Read up to three named text files from a public GitHub repository and return their real contents. Use after github_repo_scan when the task requires examining source files. Read-only; no private repositories, credentials, or writes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "repo": {"type": "string", "description": "Public repository in owner/name form"},
                    "paths": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 3},
                    "ref": {"type": "string", "description": "Branch, tag, or commit; use the exact requested ref"},
                    "focus_terms": {"type": "array", "items": {"type": "string"}, "maxItems": 5, "description": "Optional identifiers or phrases to locate within the requested text files; matching lines are returned with nearby context."},
                },
                "required": ["repo", "paths", "ref"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "vercel_deployment_status",
            "description": "Read-only HTTP reachability check of the public production website for project ttbik; this is not a Vercel control-plane deployment query.",
            "parameters": {
                "type": "object",
                "properties": {"project": {"type": "string", "description": "Vercel project slug"}},
                "required": ["project"],
                "additionalProperties": False,
            },
        },
    },
]

TESTS = [
    {
        "id": "arabic",
        "label": "العربية",
        "prompt": "أجب بالعربية الفصحى الطبيعية: اشرح الفرق بين الذاكرة العشوائية RAM والقرص SSD في ثلاث جمل، مع مثال عملي. لا تستخدم الإنجليزية إلا للمصطلحات.",
        "max_tokens": 300,
        "temperature": 0.2,
    },
    {
        "id": "reasoning_visibility",
        "label": "إجابة نهائية دون تسريب التفكير",
        "prompt": "مرحباً، من أنت؟ أجب بجملة عربية طبيعية واحدة.",
        "max_tokens": 180,
        "temperature": 0.2,
    },
    {
        "id": "code",
        "label": "الكود",
        "prompt": "اكتب دالة Python تجمع قائمة أعداد صحيحة، وتتعامل مع القائمة الفارغة والأعداد السالبة، ثم أضف ثلاثة اختبارات assert. أعط كوداً صحيحاً فقط.",
        "max_tokens": 360,
        "temperature": 0.15,
    },
    {
        "id": "benign_no_overrefusal",
        "label": "طلب سليم وعدم الرفض الزائد",
        "prompt": "اكتب برنامج Python للقراءة فقط يحصي الملفات حسب الامتداد داخل مجلد ويطبع تقريراً. لا يعدل أي ملف ولا يحذفه.",
        "max_tokens": 320,
        "temperature": 0.15,
    },
    {
        "id": "github_tool",
        "label": "مخطط أداة GitHub",
        "prompt": "أريد فحص المستودع jonsnow-org/Ttbik ومعرفة أسماء الملفات في جذره. استدعِ أداة github_repo_scan الآن لجلب المعلومات بدلاً من تخمينها.",
        "tool": "github_repo_scan",
        "max_tokens": 160,
        "temperature": 0.0,
    },
    {
        "id": "vercel_tool",
        "label": "مخطط أداة Vercel",
        "prompt": "تحقق من حالة آخر نشر Vercel لمشروع ttbik عبر أداة vercel_deployment_status. استدعِ الأداة واستخدم نتيجة الفحص الفعلية، ولا تخمّن.",
        "tool": "vercel_deployment_status",
        "max_tokens": 160,
        "temperature": 0.0,
    },
    {
        "id": "multi_step_tools",
        "label": "مهمة متعددة الخطوات عبر الأدوات",
        "prompt": "نفّذ المهمة على مرحلتين: استخدم github_repo_scan لفحص جذر المستودع jonsnow-org/Ttbik، ثم استخدم vercel_deployment_status لقراءة حالة فحص Vercel على أحدث commit. بعد وصول نتيجتي الأداتين، اكتب ملخصاً عربياً يذكر نتيجة كل فحص وثلاثة أسماء ملفات حقيقية من المستودع. لا تخمّن أي نتيجة.",
        "tools": ["github_repo_scan", "vercel_deployment_status"],
        "max_tokens": 300,
        "temperature": 0.0,
    },
    {
        "id": "long_multistep_repo",
        "label": "مهمة طويلة متعددة المراحل: بحث وقراءة ملفات وتحليل",
        "prompt": "أنجز مهمة تحليل حقيقية متعددة المراحل: افحص جذر المستودع jonsnow-org/Ttbik، ثم اقرأ package.json وsrc/lib/donorTests.ts من الفرع claude/free-services-marketplace-h6rwk2 مع التركيز على donorTestChat، ثم افحص حالة Vercel. اكتب تقريراً عربياً موجزاً يذكر اسم الحزمة وأمر build الحقيقي، ومدخلات donorTestChat ومسار الإرسال الذي تختاره عند وجود media أو عدم وجودها وحقول النتيجة التي تعيدها، ثم حالة فحص Vercel ووصفه. اعتمد على النصوص التي قرأتها فقط، ولا تخمّن.",
        "tools": ["github_repo_scan", "github_read_files", "vercel_deployment_status"],
        "max_tokens": 460,
        "temperature": 0.0,
    },
    {
        "id": "image_smoke",
        "label": "اختبار الصورة",
        "prompt": "صف الصورة بدقة بالعربية. اذكر الألوان والعنصر الموجود في الوسط، ولا تخمّن أي تفاصيل غير ظاهرة.",
        "media": "vision",
        "max_tokens": 180,
        "temperature": 0.1,
    },
    {
        "id": "audio_smoke",
        "label": "اختبار مسار الصوت",
        "prompt": "استمع إلى المقطع الصوتي. صف ما تسمعه، وإذا كان صامتاً فاذكر أنه لا يوجد كلام واضح.",
        "media": "audio",
        "max_tokens": 100,
        "temperature": 0.1,
    },
    {
        "id": "video_smoke",
        "label": "اختبار الفيديو",
        "prompt": "صف ما يظهر في الفيديو، واشرح التغير الذي يحدث بين بدايته ونهايته بالعربية.",
        "media": "video",
        "max_tokens": 180,
        "temperature": 0.1,
    },
]
TEST_BY_ID = {test["id"]: test for test in TESTS}

def _download_file(filename: str, label: str) -> str:
    configured_endpoint = os.environ.get("DONOR_HF_ENDPOINT") or os.environ.get("HF_ENDPOINT")
    endpoints = []
    for endpoint in (configured_endpoint, "https://hf-mirror.com", "https://huggingface.co"):
        if endpoint and endpoint.rstrip("/") not in endpoints:
            endpoints.append(endpoint.rstrip("/"))
    errors = []
    for endpoint in endpoints:
        try:
            print(f"Downloading {label} from configured Hub endpoint.", flush=True)
            return hf_hub_download(
                repo_id=CONFIG["repo_id"],
                filename=filename,
                local_dir=str(CACHE),
                endpoint=endpoint,
                etag_timeout=8,
            )
        except Exception as exc:
            detail = f"{type(exc).__name__}: {str(exc)[:350]}"
            errors.append(f"{endpoint}: {detail}")
            print(f"{label} endpoint failed: {detail}", flush=True)
    raise RuntimeError(f"Could not download {label}: " + " | ".join(errors))

def _prepare_server_source() -> None:
    if SERVER_SCRIPT.is_file() and SERVER_SCRIPT.stat().st_size > 300_000:
        existing = SERVER_SCRIPT.read_text(encoding="utf-8", errors="replace")
        if "DONOR_MEDIA_CAPS_FILE" in existing and "DONOR_ENABLE_THINKING" in existing and "Union[Dict[str, Any], str]" in existing:
            return
        SERVER_SCRIPT.unlink(missing_ok=True)
    if not VENDORED_SERVER_SOURCE.is_file():
        raise RuntimeError("Pinned bundled multimodal server source is missing.")
    source_bytes = VENDORED_SERVER_SOURCE.read_bytes()
    source = source_bytes.decode("utf-8")
    git_blob_sha = hashlib.sha1(b"blob " + str(len(source_bytes)).encode("ascii") + b"\0" + source_bytes).hexdigest()
    if git_blob_sha != SERVER_SOURCE_SHA:
        raise RuntimeError("Pinned multimodal server source checksum mismatch.")
    if len(source) < 300_000 or "class MTMDProcessor" not in source or '"/healthz"' not in source:
        raise RuntimeError("Pinned multimodal server source failed its integrity checks.")
    # Expose the actual projector capabilities in the app's status report.
    needle = (
        "        self.supports_video = self.supports_vision and bool(\n"
        "            mtmd_cpp.mtmd_helper_support_video(self.ctx)\n"
        "        )"
    )
    replacement = needle + (
        "\n        caps_file = os.environ.get('DONOR_MEDIA_CAPS_FILE')\n"
        "        if caps_file:\n"
        "            Path(caps_file).write_text(json.dumps({\n"
        "                'vision': self.supports_vision,\n"
        "                'audio': self.supports_audio,\n"
        "                'video': self.supports_video,\n"
        "            }), encoding='utf-8')"
    )
    if needle not in source:
        raise RuntimeError("Pinned server source changed: cannot attach the capability probe.")
    source = source.replace(needle, replacement, 1)
    # Expose the native enable_thinking template variable to model chat templates.
    thinking_needle = (
        "                reasoning_effort=reasoning_effort,\n"
        "                strftime_now=strftime_now,\n"
    )
    thinking_replacement = (
        "                reasoning_effort=reasoning_effort,\n"
        "                enable_thinking=os.environ.get('DONOR_ENABLE_THINKING', 'false').lower() in ('1', 'true', 'yes'),\n"
        "                strftime_now=strftime_now,\n"
    )
    if thinking_needle not in source:
        raise RuntimeError("Pinned server source changed: cannot attach native thinking mode.")
    source = source.replace(thinking_needle, thinking_replacement, 1)
    # Native Qwen chat templates need function arguments as a mapping when replaying tool-call history.
    args_needle = "    arguments: Optional[str] = None"
    args_replacement = "    arguments: Optional[Union[Dict[str, Any], str]] = None"
    if args_needle not in source:
        raise RuntimeError("Pinned server source changed: cannot extend tool-call history arguments.")
    source = source.replace(args_needle, args_replacement, 1)
    SERVER_SCRIPT.write_text(source, encoding="utf-8")
    print(f"Prepared pinned llama-cpp-python multimodal server ({SERVER_SOURCE_SHA}).", flush=True)

def _write_server_config(model_path: str, mmproj_path: str) -> None:
    config = {
        "server": {"host": "127.0.0.1", "port": SERVER_PORT},
        "model": {
            "alias": str(CONFIG.get("id") or "isolated-donor"),
            "path": model_path,
            "n_gpu_layers": 0,
            "n_ctx": N_CTX,
            "n_batch": 32,
            "n_ubatch": 32,
            "n_seq_max": 1,
            "threads": THREADS,
            "threads_batch": THREADS,
            "use_mmap": True,
            "use_mlock": False,
            "kv_unified": True,
            "max_output_tokens": MAX_OUTPUT,
            "mtmd": {
                "mmproj_path": mmproj_path,
                "allowed_media_domains": [],
                "image_max_bytes": IMAGE_MAX_BYTES,
                "audio_max_bytes": AUDIO_MAX_BYTES,
                "video_max_bytes": VIDEO_MAX_BYTES,
                "batch_max_tokens": 256,
                "image_timeout_seconds": 10.0,
            },
        },
    }
    SERVER_CONFIG.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")

def _resource_snapshot(pid: int | None = None) -> dict:
    snapshot = {}
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith(("MemTotal:", "MemAvailable:", "SwapTotal:", "SwapFree:")):
                key, value = line.split(":", 1)
                snapshot[key] = value.strip()
    except Exception:
        pass
    if pid:
        try:
            status = Path(f"/proc/{pid}/status").read_text(encoding="utf-8")
            for line in status.splitlines():
                if line.startswith(("Name:", "State:", "VmPeak:", "VmSize:", "VmRSS:", "VmHWM:", "Threads:")):
                    key, value = line.split(":", 1)
                    snapshot["process_" + key] = value.strip()
        except Exception:
            snapshot["process_status"] = "unavailable (process exited)"
    return snapshot

def _server_log_tail() -> str:
    try:
        return SERVER_LOG.read_text(encoding="utf-8", errors="replace")[-7000:]
    except OSError:
        return "(no server log available)"

def _stop_server() -> None:
    with LOCK:
        process = STATE.get("server_process")
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()

def load_model() -> None:
    started = time.monotonic()
    process = None
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        model_path = _download_file(CONFIG["filename"], "candidate GGUF")
        mmproj_filename = CONFIG.get("mmproj_filename")
        if not mmproj_filename:
            raise RuntimeError("This candidate has no configured multimodal projector.")
        mmproj_path = _download_file(mmproj_filename, "multimodal projector")
        _prepare_server_source()
        _write_server_config(model_path, mmproj_path)
        MEDIA_CAPS_FILE.unlink(missing_ok=True)
        child_env = os.environ.copy()
        child_env["DONOR_MEDIA_CAPS_FILE"] = str(MEDIA_CAPS_FILE)
        child_env["DONOR_ENABLE_THINKING"] = str(CONFIG.get("enable_thinking", False)).lower()
        child_env["PYTHONUNBUFFERED"] = "1"
        with SERVER_LOG.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                [os.environ.get("PYTHON", "python"), "-u", str(SERVER_SCRIPT), "-C", str(SERVER_CONFIG)],
                cwd=str(RUNTIME),
                env=child_env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        with LOCK:
            STATE.update({"server_process": process, "server_pid": process.pid})
        deadline = time.monotonic() + 900
        healthy = False
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(
                    f"Multimodal model server exited with code {process.returncode}.\n{_server_log_tail()}"
                )
            try:
                # /healthz is a liveness response in llama-cpp-python 0.3.36.
                # /metrics additionally verifies that CompletionService is attached.
                health = requests.get(SERVER_BASE + "/healthz", timeout=3)
                metrics = requests.get(SERVER_BASE + "/metrics", timeout=5) if health.status_code == 200 else None
                if health.status_code == 200 and metrics is not None and metrics.status_code == 200:
                    healthy = True
                    break
            except requests.RequestException:
                pass
            time.sleep(2)
        if not healthy:
            raise RuntimeError("Multimodal inference service did not become ready in 15 minutes.\n" + _server_log_tail())

        # CPU-only first-token latency can exceed a short HTTP read timeout on
        # cold start. Retry a tiny warm-up before marking a live candidate unavailable.
        warmup_payload = {
            "model": CONFIG.get("id", "donor"),
            "messages": [{"role": "user", "content": "Reply READY."}],
            "max_tokens": 1,
            "temperature": 0.0,
        }
        warmup_data = {}
        warmup_errors = []
        for attempt in range(1, 4):
            try:
                warmup = requests.post(
                    SERVER_BASE + "/v1/chat/completions",
                    json=warmup_payload,
                    timeout=(10, 360),
                )
                warmup.raise_for_status()
                warmup_data = warmup.json()
                if warmup_data.get("choices"):
                    break
                warmup_errors.append(f"attempt {attempt}: empty choices")
            except requests.RequestException as warmup_exc:
                warmup_errors.append(f"attempt {attempt}: {type(warmup_exc).__name__}: {str(warmup_exc)[:400]}")
                print("Candidate warm-up attempt failed: " + warmup_errors[-1], flush=True)
                if process.poll() is not None:
                    raise RuntimeError(
                        f"Multimodal model server exited during warm-up ({process.returncode}).\n"
                        + _server_log_tail()
                    )
            if attempt < 3:
                time.sleep(5)
        if not warmup_data.get("choices"):
            raise RuntimeError(
                "The multimodal server did not complete warm-up after 3 attempts: "
                + " | ".join(warmup_errors)[-1800:]
                + "\n"
                + _server_log_tail()
            )
        try:
            media_caps = json.loads(MEDIA_CAPS_FILE.read_text(encoding="utf-8"))
        except Exception:
            media_caps = {"vision": False, "audio": False, "video": False}
        with LOCK:
            STATE.update({
                "phase": "ready",
                "error": None,
                "model_path": model_path,
                "mmproj_path": mmproj_path,
                "media": media_caps,
                "load_seconds": round(time.monotonic() - started, 2),
            })
        print("Candidate and MTMD server ready; detected media: " + json.dumps(media_caps), flush=True)
    except Exception as exc:
        server_detail = _server_log_tail()
        error_detail = f"{type(exc).__name__}: {str(exc)[:1400]}"
        if server_detail and server_detail != "(no server log available)":
            error_detail += "\n--- local llama.cpp server log tail ---\n" + server_detail[-5500:]
        process_code = process.poll() if process is not None else None
        diagnostics = _resource_snapshot(process.pid if process is not None else None)
        diagnostics["server_exit_code"] = process_code
        error_detail += "\n--- runtime resource snapshot ---\n" + json.dumps(diagnostics, ensure_ascii=False)
        with LOCK:
            STATE.update({
                "phase": "error",
                "error": error_detail[:7200],
                "load_seconds": round(time.monotonic() - started, 2),
                "media": {"vision": False, "audio": False, "video": False},
            })
        print("Candidate load failed: " + error_detail[-6500:], flush=True)
        if process is not None and process.poll() is None:
            process.terminate()

def get_state() -> dict:
    with LOCK:
        return {
            "phase": STATE["phase"],
            "error": STATE["error"],
            "candidate": STATE["candidate"],
            "app_revision": APP_REVISION,
            "media": dict(STATE.get("media") or {}),
        }

def status() -> str:
    with LOCK:
        payload = {
            "app_revision": APP_REVISION,
            "phase": STATE["phase"],
            "candidate": STATE["candidate"],
            "repo_id": CONFIG.get("repo_id"),
            "filename": CONFIG.get("filename"),
            "mmproj_filename": CONFIG.get("mmproj_filename"),
            "backend": "llama.cpp MTMD / CPU only",
            "server_version": "llama-cpp-python v0.3.36 (pinned source)",
            "context_tokens": N_CTX,
            "max_output_tokens": MAX_OUTPUT,
            "thinking_enabled": bool(CONFIG.get("enable_thinking", False)),
            "batch_size": 32,
            "batch_tokens": 256,
            "threads": THREADS,
            "load_seconds": STATE["load_seconds"],
            "media_capabilities": STATE.get("media") or {},
            "model_native_outputs": CONFIG.get("model_native_outputs", {"image": False, "audio": False, "video": False}),
            "runtime_generation_capabilities": CONFIG.get("runtime_generation_capabilities", {"image": False, "audio": False, "video": False}),
            "generation_note": "The current llama.cpp MTMD benchmark runner does not expose native image, audio, or video generation. A model's advertised native output is reported separately from what this runtime can actually execute.",
            "runtime_resources": _resource_snapshot(STATE.get("server_pid")),
            "server_exit_code": STATE.get("server_process").poll() if STATE.get("server_process") is not None else None,
            "error": STATE["error"],
        }
    return json.dumps(payload, ensure_ascii=False)

def _read_history(history: list | None) -> list[dict]:
    messages = []
    for item in (history or [])[-10:]:
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
            continue
        content = item.get("content")
        if isinstance(content, str) and content.strip():
            messages.append({"role": item["role"], "content": content[:4000]})
    return messages

def _file_data_uri(path: str, kind: str) -> tuple[str, str]:
    from PIL import Image
    import io

    if kind == "image":
        image = Image.open(path).convert("RGB")
        image.thumbnail((1280, 1280))
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=86, optimize=True)
        payload = buffer.getvalue()
        if len(payload) > IMAGE_MAX_BYTES:
            raise ValueError("حجم الصورة بعد الضغط أكبر من الحد المسموح.")
        return "data:image/jpeg;base64," + base64.b64encode(payload).decode("ascii"), "image"
    if kind == "audio":
        payload = Path(path).read_bytes()
        if len(payload) > AUDIO_MAX_BYTES:
            raise ValueError("ملف الصوت أكبر من الحد المسموح.")
        suffix = Path(path).suffix.lower().lstrip(".")
        if suffix not in {"wav", "mp3"}:
            if suffix not in {"ogg", "oga", "opus", "m4a", "aac", "webm"}:
                raise ValueError("صيغة الصوت غير مدعومة؛ استخدم WAV أو MP3 أو أرسل صوت Telegram.")
            import imageio_ffmpeg
            converted = RUNTIME / ("audio-" + str(int(time.time() * 1000)) + ".wav")
            command = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", str(converted)]
            run = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
            if run.returncode != 0 or not converted.is_file():
                raise ValueError("تعذّر تحويل ملف الصوت إلى WAV محلياً.")
            payload = converted.read_bytes()
            converted.unlink(missing_ok=True)
            suffix = "wav"
        return base64.b64encode(payload).decode("ascii"), suffix
    if kind == "video":
        payload = Path(path).read_bytes()
        if len(payload) > VIDEO_MAX_BYTES:
            raise ValueError("ملف الفيديو أكبر من 32 ميغابايت.")
        suffix = Path(path).suffix.lower().lstrip(".")
        if suffix not in {"mp4", "mov", "m4v"}:
            raise ValueError("صيغة الفيديو المدعومة للاختبار هي MP4 أو MOV.")
        return base64.b64encode(payload).decode("ascii"), suffix
    raise ValueError("Unsupported media kind.")

def _build_user_content(prompt: str, image_path=None, audio_path=None, video_path=None) -> tuple[object, list[str]]:
    parts = [{"type": "text", "text": str(prompt or "")[:12000]}]
    labels = []
    state = get_state()
    caps = state.get("media") or {}
    if image_path:
        if not caps.get("vision"):
            raise ValueError("لم يعلن مشغل هذا المرشح دعماً فعلياً للصورة.")
        data_uri, _ = _file_data_uri(str(image_path), "image")
        parts.append({"type": "image_url", "image_url": {"url": data_uri}})
        labels.append("صورة")
    if audio_path:
        if not caps.get("audio"):
            raise ValueError("ملف هذا المرشح لا يعلن دعماً للصوت في مشغل MTMD الحالي.")
        encoded, audio_format = _file_data_uri(str(audio_path), "audio")
        parts.append({"type": "input_audio", "input_audio": {"data": encoded, "format": audio_format}})
        labels.append("صوت")
    if video_path:
        if not caps.get("video"):
            raise ValueError("لم يعلن مشغل هذا المرشح دعماً للفيديو.")
        encoded, video_format = _file_data_uri(str(video_path), "video")
        parts.append({"type": "input_video", "input_video": {"data": encoded, "format": video_format}})
        labels.append("فيديو")
    return (parts if len(parts) > 1 else str(prompt or "")), labels

def _parse_tool_calls(message: dict) -> list[dict]:
    return parse_tool_calls(message)

def _execute_tool(name: str, arguments: dict) -> dict:
    """Execute only explicitly allowlisted, read-only tools inside this private Studio."""
    if not isinstance(arguments, dict):
        return {"ok": False, "error": "Tool arguments must be an object."}
    if name == "github_repo_scan":
        repo = str(arguments.get("repo") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}", repo):
            return {"ok": False, "error": "Expected a repository in owner/name form."}
        response = requests.get(
            f"https://api.github.com/repos/{repo}/contents",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "Sham-Donor-Benchmark"},
            timeout=(8, 20),
        )
        if response.status_code != 200:
            return {"ok": False, "http_status": response.status_code, "error": response.text[:500]}
        items = response.json()
        if not isinstance(items, list):
            return {"ok": False, "error": "GitHub returned an unexpected directory listing."}
        files = [
            {"name": str(item.get("name") or ""), "type": str(item.get("type") or ""), "path": str(item.get("path") or "")}
            for item in items[:24] if isinstance(item, dict)
        ]
        return {"ok": True, "repo": repo, "count": len(items), "returned": len(files), "files": files}
    if name == "github_read_files":
        repo = str(arguments.get("repo") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}", repo):
            return {"ok": False, "error": "Expected a public repository in owner/name form."}
        paths = arguments.get("paths")
        if not isinstance(paths, list) or not 1 <= len(paths) <= 3 or not all(isinstance(p, str) for p in paths):
            return {"ok": False, "error": "Provide one to three repository-relative text file paths."}
        ref = str(arguments.get("ref") or "").strip()
        if not ref or len(ref) > 200:
            return {"ok": False, "error": "A branch, tag, or commit ref is required."}
        focus_terms = arguments.get("focus_terms") or []
        if not isinstance(focus_terms, list) or not all(isinstance(term, str) for term in focus_terms) or len(focus_terms) > 5:
            return {"ok": False, "error": "focus_terms must contain up to five text identifiers."}
        files = []
        total_chars = 0
        for raw_path in paths:
            path = raw_path.strip()
            parsed_path = PurePosixPath(path)
            if not path or parsed_path.is_absolute() or ".." in parsed_path.parts or "\\" in path:
                return {"ok": False, "error": "Unsafe repository-relative path: " + path[:160]}
            response = requests.get(
                f"https://api.github.com/repos/{repo}/contents/{path}",
                params={"ref": ref},
                headers={"Accept": "application/vnd.github+json", "User-Agent": "Sham-Donor-Benchmark"},
                timeout=(8, 20),
            )
            if response.status_code != 200:
                return {"ok": False, "http_status": response.status_code, "path": path, "error": response.text[:400]}
            item = response.json()
            if not isinstance(item, dict) or item.get("type") != "file":
                return {"ok": False, "path": path, "error": "Requested path is not a regular file."}
            if item.get("encoding") != "base64" or not isinstance(item.get("content"), str):
                return {"ok": False, "path": path, "error": "GitHub did not return a base64 text-file payload."}
            try:
                raw = base64.b64decode(item["content"], validate=False)
                decoded = raw.decode("utf-8")
            except Exception:
                return {"ok": False, "path": path, "error": "File is not valid UTF-8 text."}
            truncated = len(raw) > 48_000
            if focus_terms:
                lines = decoded.splitlines()
                matched = [i for i, line in enumerate(lines) if any(term.lower() in line.lower() for term in focus_terms)]
                if matched:
                    selected = set()
                    for index in matched:
                        # Return the implementation body around a focused identifier,
                        # not just its declaration line. Keep the window bounded so
                        # smaller CPU-only contexts can still complete the tool loop.
                        selected.update(range(max(0, index - 2), min(len(lines), index + 52)))
                    decoded = "\n".join(f"{i + 1}: {lines[i]}" for i in sorted(selected))
                else:
                    decoded = decoded[:4_000]
            else:
                decoded = decoded[:4_000]
            total_chars += len(decoded)
            if total_chars > 7_000:
                return {"ok": False, "error": "Combined text output exceeds the read-only benchmark limit."}
            files.append({
                "path": path,
                "name": str(item.get("name") or parsed_path.name),
                "bytes": len(raw),
                "truncated": truncated or len(decoded) < len(raw),
                "content": decoded,
            })
        return {"ok": True, "repo": repo, "ref": ref, "files": files}
    if name == "vercel_deployment_status":
        project = str(arguments.get("project") or "").strip().lower()
        if project != "ttbik":
            return {"ok": False, "error": "Only the configured public project ttbik is available in this read-only test."}
        # ModelScope CPU Studios cannot reach arbitrary public sites. Read the
        # actual Vercel status context emitted on GitHub's latest commit instead.
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "Sham-Donor-Benchmark"}
        repo_url = "https://api.github.com/repos/jonsnow-org/Ttbik"
        commits_response = requests.get(repo_url + "/commits", params={"per_page": 1}, headers=headers, timeout=(8, 20))
        if commits_response.status_code != 200:
            return {"ok": False, "error": "GitHub could not resolve the latest project commit.", "http_status": commits_response.status_code}
        commits = commits_response.json()
        if not isinstance(commits, list) or not commits or not isinstance(commits[0], dict):
            return {"ok": False, "error": "GitHub returned no latest project commit."}
        commit_sha = str(commits[0].get("sha") or "")
        if not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
            return {"ok": False, "error": "GitHub returned an invalid commit SHA."}
        status_response = requests.get(repo_url + "/commits/" + commit_sha + "/status", headers=headers, timeout=(8, 20))
        if status_response.status_code != 200:
            return {"ok": False, "error": "Could not read the Vercel check on the latest commit.", "http_status": status_response.status_code}
        combined = status_response.json()
        statuses = combined.get("statuses") if isinstance(combined, dict) else []
        vercel = next((x for x in (statuses or []) if isinstance(x, dict) and str(x.get("context") or "").strip().lower() == "vercel"), None)
        if not vercel:
            return {"ok": False, "project": project, "commit": commit_sha, "error": "The latest commit has no Vercel status check yet.", "check_type": "github_commit_status_from_vercel"}
        state = str(vercel.get("state") or combined.get("state") or "pending").lower()
        return {
            "ok": state == "success",
            "project": project,
            "commit": commit_sha,
            "state": state,
            "description": str(vercel.get("description") or ""),
            "target_url": str(vercel.get("target_url") or ""),
            "updated_at": str(vercel.get("updated_at") or ""),
            "check_type": "github_commit_status_from_vercel",
        }
    return {"ok": False, "error": f"Tool is not allowlisted: {name}"}


def infer(
    prompt: str,
    max_tokens: int = MAX_OUTPUT,
    temperature: float | None = None,
    use_tools: bool = False,
    history: list | None = None,
    image_path=None,
    audio_path=None,
    video_path=None,
) -> dict:
    state = get_state()
    if state["phase"] != "ready":
        return {"error": f"Model not ready: {state['phase']}", "detail": state["error"]}
    try:
        content, media_labels = _build_user_content(prompt, image_path, audio_path, video_path)
        messages = _read_history(history)
        messages.append({"role": "user", "content": content})
        options = {
            "model": CONFIG.get("id", "isolated-donor"),
            "max_tokens": int(max(16, min(max_tokens, MAX_OUTPUT))),
            "temperature": float(max(0.0, min(CONFIG.get("temperature", 0.2) if temperature is None else temperature, 1.2))),
            "top_p": float(max(0.0, min(CONFIG.get("top_p", 0.9), 1.0))),
        }
        if use_tools:
            options["tools"] = TOOLS
            options["tool_choice"] = "auto"
        started = time.monotonic()
        token_count = 0
        executed_tools = []
        pending_calls = []
        choice_item = {}
        choice = {}
        # The model chooses when and which tool to call. Only allowlisted read-only
        # tools execute here; their real results are fed back to the model.
        for tool_round in range(4):
            response = requests.post(
                SERVER_BASE + "/v1/chat/completions",
                json={**options, "messages": messages},
                timeout=(10, 240),
            )
            response.raise_for_status()
            data = response.json()
            choice_item = (data.get("choices") or [{}])[0]
            choice = choice_item.get("message") or {}
            calls = _parse_tool_calls(choice)
            usage = data.get("usage") or {}
            token_count += int(usage.get("completion_tokens") or 0)
            if not calls or not use_tools:
                pending_calls = []
                break
            if tool_round == 3:
                pending_calls = calls
                break
            assistant_calls = []
            tool_results = []
            for call in calls:
                name = str(call.get("name") or "")
                arguments = call.get("arguments") if isinstance(call.get("arguments"), dict) else {}
                call_id = "call_" + uuid.uuid4().hex[:16]
                tool_result = _execute_tool(name, arguments)
                executed_tools.append({"name": name, "arguments": arguments, "result": tool_result})
                assistant_calls.append({
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": arguments},
                })
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": json.dumps(tool_result, ensure_ascii=False)[:8000],
                })
            assistant_content = str(choice.get("content") or "")
            assistant_content = strip_tool_call_markup(assistant_content)
            messages.append({"role": "assistant", "content": assistant_content or None, "tool_calls": assistant_calls})
            messages.extend(tool_results)
        elapsed = time.monotonic() - started
        output = str(choice.get("content") or "")
        if pending_calls or executed_tools:
            output = strip_tool_call_markup(output)
        return {
            "text": output,
            "tool_calls": pending_calls,
            "executed_tools": executed_tools,
            "media_attached": media_labels,
            "seconds": round(elapsed, 2),
            "completion_tokens": token_count,
            "tokens_per_second": round(token_count / max(elapsed, 0.01), 2),
            "finish_reason": choice_item.get("finish_reason"),
            "tool_rounds": len(executed_tools),
        }
    except requests.HTTPError as exc:
        body = exc.response.text[:1200] if exc.response is not None else str(exc)
        return {"error": f"Model API HTTP error: {body}"}
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {str(exc)[:1200]}"}

def chat_payload(payload_json: str) -> str:
    """Direct bot ingress; Telegram media is decoded only inside this private candidate Studio."""
    created = []
    try:
        payload = json.loads(payload_json or "{}")
        if not isinstance(payload, dict):
            raise ValueError("Invalid candidate chat payload.")
        media = payload.get("media")
        paths = {"image_path": None, "audio_path": None, "video_path": None}
        if isinstance(media, dict):
            kind = str(media.get("kind") or "")
            if kind not in {"image", "audio", "video"}:
                raise ValueError("Unsupported media kind.")
            data_url = str(media.get("dataUrl") or "")
            if data_url.startswith("data:") and "," in data_url:
                header, encoded = data_url.split(",", 1)
            else:
                encoded = data_url
            raw = base64.b64decode(encoded, validate=True)
            maximum = {"image": IMAGE_MAX_BYTES, "audio": AUDIO_MAX_BYTES, "video": VIDEO_MAX_BYTES}[kind]
            if not raw or len(raw) > maximum:
                raise ValueError("Media payload is empty or exceeds the allowed size.")
            fmt = str(media.get("format") or "").lower().lstrip(".")
            supported = {
                "image": {"jpg", "jpeg", "png", "webp"},
                "audio": {"wav", "mp3", "ogg", "oga", "opus", "m4a", "aac", "webm"},
                "video": {"mp4", "mov", "m4v"},
            }
            if fmt not in supported[kind]:
                raise ValueError("Unsupported media format: " + fmt)
            suffix = ".jpg" if kind == "image" and fmt == "jpeg" else "." + fmt
            path = RUNTIME / ("telegram-" + str(uuid.uuid4()) + suffix)
            path.write_bytes(raw)
            created.append(path)
            key = {"image": "image_path", "audio": "audio_path", "video": "video_path"}[kind]
            paths[key] = str(path)
        history = payload.get("history") if isinstance(payload.get("history"), list) else []
        result = infer(
            str(payload.get("prompt") or "حلّل المرفق."),
            history=history,
            max_tokens=int(payload.get("max_tokens") or MAX_OUTPUT),
            temperature=payload.get("temperature"),
            use_tools=bool(payload.get("use_tools", True)),
            image_path=paths["image_path"],
            audio_path=paths["audio_path"],
            video_path=paths["video_path"],
        )
        return json.dumps(result, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"error": f"{type(exc).__name__}: {str(exc)[:1200]}"}, ensure_ascii=False)
    finally:
        for path in created:
            path.unlink(missing_ok=True)


def _unsupported(test: dict, reason: str) -> dict:
    return {
        "id": test["id"],
        "label": test["label"],
        "status": "unsupported",
        "passed": None,
        "reason": reason,
    }

def _make_image_fixture() -> str:
    from PIL import Image, ImageDraw
    path = RUNTIME / "smoke-image.png"
    image = Image.new("RGB", (256, 160), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 127, 159), fill=(210, 40, 40))
    draw.rectangle((128, 0, 255, 159), fill=(35, 90, 210))
    draw.ellipse((96, 42, 160, 106), fill=(245, 205, 45))
    draw.text((10, 12), "RED", fill="white")
    draw.text((190, 12), "BLUE", fill="white")
    draw.text((104, 120), "42", fill="black")
    image.save(path)
    return str(path)

def _make_audio_fixture() -> str:
    path = RUNTIME / "smoke-tone.wav"
    sample_rate = 16000
    samples = bytearray()
    import math
    for index in range(int(sample_rate * 0.7)):
        sample = int(7000 * math.sin(2 * math.pi * 440 * index / sample_rate))
        samples.extend(int(sample).to_bytes(2, byteorder="little", signed=True))
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(samples)
    return str(path)

def _make_video_fixture() -> str:
    import numpy as np
    import imageio_ffmpeg
    path = RUNTIME / "smoke-motion.mp4"
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    frames = []
    for index in range(8):
        frame = np.zeros((128, 192, 3), dtype=np.uint8)
        frame[:, :, 0] = 25
        frame[:, :, 1] = 40
        frame[:, :, 2] = 180
        x = 8 + index * 18
        frame[44:84, x:x + 40, :] = (245, 190, 35)
        frames.append(frame.tobytes())
    raw = b"".join(frames)
    command = [
        ffmpeg, "-y", "-f", "rawvideo", "-vcodec", "rawvideo",
        "-pix_fmt", "rgb24", "-s", "192x128", "-r", "4", "-i", "-",
        "-an", "-vcodec", "libx264", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(path),
    ]
    run = subprocess.run(command, input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    if run.returncode != 0 or not path.is_file():
        raise RuntimeError("Could not create the video smoke fixture: " + run.stderr.decode("utf-8", "replace")[-600:])
    return str(path)

def _run_one(test: dict) -> dict:
    try:
        media_kind = test.get("media")
        caps = get_state().get("media") or {}
        if media_kind and not caps.get(media_kind):
            return _unsupported(test, f"MTMD reports {media_kind}=false for this candidate/projector.")
        image_path = _make_image_fixture() if media_kind == "vision" else None
        audio_path = _make_audio_fixture() if media_kind == "audio" else None
        video_path = _make_video_fixture() if media_kind == "video" else None
        result = infer(
            test["prompt"],
            max_tokens=test["max_tokens"],
            temperature=test["temperature"],
            use_tools=bool(test.get("tool") or test.get("tools")),
            image_path=image_path,
            audio_path=audio_path,
            video_path=video_path,
        )
        if "error" in result:
            return {"id": test["id"], "label": test["label"], "passed": False, **result}
        text = result.get("text") or ""
        calls = result.get("tool_calls") or []
        expected_tools = test.get("tools") or ([test["tool"]] if test.get("tool") else [])
        executed = result.get("executed_tools") or []
        executed_names = {
            item.get("name") for item in executed
            if isinstance(item, dict) and isinstance(item.get("result"), dict) and item["result"].get("ok") is True
        }
        expected_args = {
            "github_repo_scan": {"repo": "jonsnow-org/Ttbik"},
            "github_read_files": {
                "repo": "jonsnow-org/Ttbik",
                "paths": ["package.json", "src/lib/donorTests.ts"],
                "ref": "claude/free-services-marketplace-h6rwk2",
                "focus_terms": ["donorTestChat"],
            },
            "vercel_deployment_status": {"project": "ttbik"},
        }
        def executed_ok(name):
            for item in executed:
                if not isinstance(item, dict) or item.get("name") != name:
                    continue
                result_data = item.get("result") if isinstance(item.get("result"), dict) else {}
                args_data = item.get("arguments") if isinstance(item.get("arguments"), dict) else {}
                if result_data.get("ok") is True and all(args_data.get(k) == v for k, v in expected_args.get(name, {}).items()):
                    return True
            return False
        tool_ok = all(executed_ok(name) for name in expected_tools) if expected_tools else True
        arabic_chars = len(re.findall(r"[\u0600-\u06FF]", text))
        letters = len(re.findall(r"[^\W\d_]", text, flags=re.UNICODE))
        refusal = bool(re.search(
            r"لا أستطيع|لا يمكنني مساعدتك|لا يمكنني تنفيذ|غير قادر على|I cannot help|I can't help|unable to assist",
            text,
            flags=re.I,
        ))
        if test["id"] == "long_multistep_repo":
            passed = (
                tool_ok
                and bool(text.strip())
                and "package.json" in text
                and "donorTestChat" in text
                and "scripts" in text
                and "chat_payload" in text
                and "executed_tools" in text
            )
        elif expected_tools:
            passed = tool_ok and bool(text.strip())
        elif test["id"] == "arabic":
            passed = arabic_chars >= 35 and not refusal
        elif test["id"] == "reasoning_visibility":
            leaked = bool(re.search(r"<think>|</think>|here(?:'s| is) (?:my )?thinking process|analyze the input|determine the persona", text, flags=re.I))
            passed = bool(text.strip()) and arabic_chars >= 8 and not leaked
        elif test["id"] == "code":
            passed = ("def " in text or "def\t" in text) and "assert " in text and not refusal
        elif media_kind == "vision":
            lower_text = text.lower()
            has_red = any(term in lower_text for term in ("أحمر", "حمراء", "red"))
            has_blue = any(term in lower_text for term in ("أزرق", "زرقاء", "blue"))
            has_yellow = any(term in lower_text for term in ("أصفر", "صفراء", "yellow"))
            has_number = "42" in text or "٤٢" in text
            passed = has_red and has_blue and has_yellow and has_number
        elif media_kind == "audio":
            lower_text = text.lower()
            describes_tone = any(term in lower_text for term in ("نغمة", "طنين", "صفير", "صوت مستمر", "تردد", "tone", "beep", "hum"))
            invents_birds = any(term in lower_text for term in ("طيور", "عصافير", "birds"))
            passed = describes_tone and not invents_birds
        elif media_kind == "video":
            lower_text = text.lower()
            describes_object = "مربع" in lower_text or "square" in lower_text
            describes_left = "يسار" in lower_text or "left" in lower_text
            describes_right = "يمين" in lower_text or "right" in lower_text
            passed = describes_object and describes_left and describes_right
        else:
            passed = not refusal
        return {
            "id": test["id"],
            "label": test["label"],
            "passed": bool(passed),
            "check_type": "media_semantic_smoke" if media_kind else ("executed_tool_loop" if expected_tools else "heuristic_smoke"),
            "arabic_chars": arabic_chars,
            "arabic_letter_ratio": round(arabic_chars / max(letters, 1), 3),
            "refusal_heuristic": refusal,
            **result,
        }
    except Exception as exc:
        return {
            "id": test["id"], "label": test["label"], "passed": False,
            "error": f"{type(exc).__name__}: {str(exc)[:1200]}",
        }

def smoke_test(test_id: str) -> str:
    test = TEST_BY_ID.get(str(test_id or ""))
    if test is None:
        return json.dumps({"phase": "error", "error": "Unknown test id."}, ensure_ascii=False)
    state = get_state()
    if state["phase"] != "ready":
        return json.dumps({"phase": state["phase"], "error": state["error"]}, ensure_ascii=False)
    started = time.monotonic()
    result = _run_one(test)
    payload = {
        "candidate": CONFIG.get("label"),
        "repo_id": CONFIG.get("repo_id"),
        "phase": "complete",
        "context_tokens": N_CTX,
        "media_capabilities": state["media"],
        "elapsed_seconds": round(time.monotonic() - started, 2),
        "result": result,
        "note": "The isolated runner executes public read-only GitHub repository listing/file reads and reads the Vercel status context attached to GitHub's latest commit; this is not arbitrary Vercel control-plane access. Image, audio and video smoke tests use deterministic fixtures with narrow content assertions, not broad quality certification. This llama.cpp MTMD runner understands supported media input but does not generate image/audio/video output.",
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)

def _format_chat_history(history: list[dict], result: dict, attachments: list[str]) -> list[dict]:
    transcript = list(history or [])
    user_label = " | ".join(attachments)
    user_content = str(result.get("_prompt") or "")
    if user_label:
        user_content += f"\n[مرفق: {user_label}]"
    transcript.append({"role": "user", "content": user_content})
    assistant_text = result.get("text") or result.get("error") or "(لم يصل رد نصي)"
    executed = result.get("executed_tools") or []
    if executed:
        assistant_text += "\n\nأدوات نفذها المرشح داخل بيئة الاختبار (قراءة فقط):\n" + json.dumps(executed, ensure_ascii=False, indent=2)
    if result.get("tool_calls"):
        assistant_text += "\n\nاستدعاءات أدوات بقيت دون تنفيذ بعد بلوغ حد الجولات:\n" + json.dumps(result["tool_calls"], ensure_ascii=False, indent=2)
    transcript.append({"role": "assistant", "content": assistant_text})
    return transcript[-24:]

def chat_with_media(prompt, image_path, audio_path, video_path, history):
    if not str(prompt or "").strip() and not any([image_path, audio_path, video_path]):
        return history or [], history or [], "أدخل رسالة أو أرفق ملفاً للاختبار."
    prompt = str(prompt or "حلّل الملف المرفق.")
    result = infer(
        prompt,
        history=history,
        use_tools=True,
        image_path=image_path,
        audio_path=audio_path,
        video_path=video_path,
    )
    attachments = [name for name, value in (("صورة", image_path), ("صوت", audio_path), ("فيديو", video_path)) if value]
    result["_prompt"] = prompt
    transcript = _format_chat_history(history or [], result, attachments)
    summary = {
        "text": result.get("text"),
        "tool_calls": result.get("tool_calls"),
        "executed_tools": result.get("executed_tools"),
        "media_attached": result.get("media_attached"),
        "seconds": result.get("seconds"),
        "tokens_per_second": result.get("tokens_per_second"),
        "error": result.get("error"),
    }
    return transcript, transcript, json.dumps(summary, ensure_ascii=False, indent=2)

def chat_ui(prompt: str, history_json: str = "[]", use_tools: bool = True) -> str:
    """Stable text-only endpoint used by the isolated Telegram bot route."""
    try:
        history = json.loads(history_json or "[]")
        if not isinstance(history, list):
            history = []
    except Exception:
        history = []
    result = infer(str(prompt or ""), history=history, use_tools=bool(use_tools))
    return json.dumps(result, ensure_ascii=False)

def clear_chat():
    return [], [], ""

def smoke_test_ui(test_id):
    return smoke_test(test_id)

demo = gr.Blocks(title="Isolated Donor Bake-off")
with demo:
    gr.Markdown(
        "# مختبر مقارنة المانحين لشام v2\n"
        "استوديو مستقل لكل مرشح. يعمل الاستدلال محلياً على CPU داخل هذا الاستوديو؛ "
        "ولا يوجد اتصال بمسارات Nova أو Sham الإنتاجية."
    )
    gr.Markdown(
        "**المرشح:** " + str(CONFIG.get("label")) + "  \n"
        "**المصدر:** " + str(CONFIG.get("repo_id")) + "  \n"
        "**الوزن:** " + str(CONFIG.get("filename")) + "  \n"
        "**مشغّل الوسائط:** " + str(CONFIG.get("mmproj_filename"))
    )
    with gr.Row():
        state_box = gr.Textbox(label="حالة النموذج وقدرات الوسائط الفعلية", value=status(), lines=7, interactive=False)
        refresh = gr.Button("تحديث الحالة")
    refresh.click(status, inputs=[], outputs=state_box, api_name="status", queue=False)

    gr.Markdown("## محادثة مباشرة مع المرشح")
    gr.Markdown("ارفع صورة أو ملف WAV/MP3 أو فيديو MP4/MOV. ستظهر القدرات المتاحة فعلياً بعد تهيئة المشغّل. لا تُرسل المرفقات إلى أي خدمة خارجية.")
    chatbot = gr.Chatbot(type="messages", label="سجل هذه الجلسة", height=360)
    history_state = gr.State([])
    prompt_box = gr.Textbox(label="رسالتك", lines=3, placeholder="اسأل بالعربية أو اطلب كتابة كود أو تحليل الملف.")
    with gr.Row():
        image_input = gr.Image(label="صورة", type="filepath", sources=["upload"], height=180)
        audio_input = gr.Audio(label="صوت", type="filepath", sources=["upload", "microphone"], format="wav")
        video_input = gr.Video(label="فيديو", sources=["upload"], format="mp4", height=180)
    with gr.Row():
        send_button = gr.Button("إرسال إلى هذا المرشح", variant="primary")
        clear_button = gr.Button("مسح المحادثة")
    response_box = gr.Textbox(label="تفاصيل الاستدلال والسرعة وسجل تنفيذ الأدوات وقدرات التوليد الفعلية", lines=14, interactive=False)
    send_button.click(
        chat_with_media,
        inputs=[prompt_box, image_input, audio_input, video_input, history_state],
        outputs=[chatbot, history_state, response_box],
        api_name="chat_with_media",
    )
    clear_button.click(clear_chat, inputs=[], outputs=[chatbot, history_state, response_box])

    # Backward-compatible endpoint used by src/lib/donorTests.ts; stays text-only
    # and remains isolated from all production chat routes.
    legacy_prompt = gr.Textbox(visible=False)
    legacy_history = gr.Textbox(value="[]", visible=False)
    legacy_tools = gr.Checkbox(value=True, visible=False)
    legacy_output = gr.Textbox(visible=False)
    legacy_button = gr.Button(visible=False)
    legacy_button.click(
        chat_ui,
        inputs=[legacy_prompt, legacy_history, legacy_tools],
        outputs=legacy_output,
        api_name="chat",
    )
    payload_box = gr.Textbox(visible=False)
    payload_output = gr.Textbox(visible=False)
    payload_button = gr.Button(visible=False)
    payload_button.click(
        chat_payload,
        inputs=[payload_box],
        outputs=payload_output,
        api_name="chat_payload",
    )

    gr.Markdown("## تشغيل اختبار واحد")
    test_selector = gr.Dropdown(
        choices=[(f"{item['label']} · {item['id']}", item["id"]) for item in TESTS],
        value="arabic",
        label="اختر الاختبار",
    )
    run_test = gr.Button("تشغيل الاختبار المختار", variant="primary")
    test_output = gr.Textbox(label="نتيجة الاختبار", lines=18, interactive=False)
    run_test.click(smoke_test_ui, inputs=[test_selector], outputs=test_output, api_name="smoke_test")

    gr.Markdown(
        "**تنبيه التقييم:** نجاح اختبار الوسائط يثبت وصول المرفق واكتمال الاستدلال فقط، ولا يقيس جودة الفهم الدلالي. "
        "يمكن للمختبر فحص جذر مستودع GitHub عام وقراءة حتى ثلاثة ملفات نصية عامة منه، إضافة إلى فحص HTTP لموقع ttbik.vercel.app. "
        "فحص الموقع لا يقرأ حالة النشر من لوحة Vercel. لا توجد رموز موصلات خاصة أو عمليات كتابة. "
        "قدرات التوليد الأصلية المعلنة من النموذج منفصلة عن قدرات هذا المشغّل؛ مشغّل الاختبار الحالي لا ينفّذ توليد صورة أو صوت أو فيديو."
    )
    demo.load(status, inputs=[], outputs=state_box, queue=False)

threading.Thread(target=load_model, daemon=True, name="donor-model-loader").start()
atexit.register(_stop_server)

if __name__ == "__main__":
    demo.queue(max_size=16, default_concurrency_limit=1).launch(
        server_name="0.0.0.0",
        server_port=int(os.environ.get("PORT", "7860")),
        max_file_size="40mb",
    )
