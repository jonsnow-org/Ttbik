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
APP_REVISION = "donor-bakeoff-2026-10-31-r10"
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

IMAGE_GENERATION_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_image",
        "description": "Create an actual image using ONLY this candidate's own dedicated private ModelScope image-weight Studio. Call it when the user asks to generate an image. Do not claim success without a returned image file.",
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string"},
                "negative_prompt": {"type": "string"},
                "seed": {"type": "integer"}
            },
            "required": ["prompt"],
            "additionalProperties": False
        }
    }
}


MEDIA_TOOLS = {
    "generate_audio": {
        "type": "function",
        "function": {
            "name": "generate_audio",
            "description": "Speak a text aloud as an Arabic voice recording, made ONLY by this candidate's own dedicated media Studio. Call it when the user asks for speech or a voice message. Do not claim success without a returned audio file.",
            "parameters": {"type": "object", "properties": {"text": {"type": "string", "description": "the words to say (Arabic)"}}, "required": ["text"], "additionalProperties": False},
        },
    },
    "generate_video": {
        "type": "function",
        "function": {
            "name": "generate_video",
            "description": "Make a short real video clip (text-to-video diffusion, not stitched pictures) from a description, ONLY with this candidate's own dedicated media Studio. Takes a few minutes. Do not claim success without a returned video file.",
            "parameters": {"type": "object", "properties": {"prompt": {"type": "string", "description": "what the clip shows (English works best)"}, "seconds": {"type": "integer", "minimum": 1, "maximum": 3}}, "required": ["prompt"], "additionalProperties": False},
        },
    },
}
MEDIA_MIME = {"audio": "audio/wav", "video": "video/mp4"}


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
        "prompt": "أنجز مهمة تحليل حقيقية متعددة المراحل ولا تكتفِ بوصف ما ستفعله: (1) استخدم github_repo_scan لفحص جذر المستودع العام jonsnow-org/Ttbik. (2) استخدم github_read_files لقراءة package.json وsrc/lib/donorTests.ts من الفرع claude/free-services-marketplace-h6rwk2، وابحث داخل الملف الثاني عن donorTestChat. (3) استخدم vercel_deployment_status لفحص استجابة الموقع العام ttbik. بعد استلام النتائج الفعلية، اكتب تقريراً عربياً منظماً يذكر أسماء الملفات، اسم الحزمة وأحد أوامر scripts الحقيقية من package.json، وظيفة donorTestChat كما تظهر في الملف، وحالة فحص Vercel وسببها. لا تخمّن ولا تكرر طلبي. اجعل التقرير موجزاً (سطر أو سطران لكل بند) حتى يكتمل ضمن حدود الإخراج.",
        "tools": ["github_repo_scan", "github_read_files", "vercel_deployment_status"],
        "max_tokens": 760,
        "temperature": 0.0,
    },
    {
        "id": "image_tool_direct",
        "label": "أداة توليد الصورة مباشرة (استوديو الصور الخاص بالمرشح، بلا محادثة)",
        "direct_tool": "generate_image",
        "direct_args": {"prompt": "A natural photograph of a quiet stone street after rain in daylight, a woman in a coat standing on the wet pavement, realistic skin and fabric"},
    },
    {
        "id": "audio_tool_direct",
        "label": "أداة الصوت مباشرة (استوديو الوسائط الخاص بالمرشح)",
        "direct_tool": "generate_audio",
        "direct_args": {"text": "مرحباً، هذا اختبار صوتي عربي قصير من استوديو الوسائط الخاص بهذا النموذج."},
    },
    {
        "id": "video_tool_direct",
        "label": "أداة الفيديو مباشرة (استوديو الوسائط الخاص بالمرشح)",
        "direct_tool": "generate_video",
        "direct_args": {"prompt": "a candle flame flickering in a dark room, slow camera", "seconds": 2},
    },
    {
        "id": "image_generation",
        "label": "توليد صورة فعلية من الوزن الخاص بالمرشح",
        "prompt": "أنشئ صورة فوتوغرافية واقعية لمشهد شارع حجري هادئ بعد المطر عند ضوء النهار. استخدم أداة generate_image فعلياً، ولا تقل إن الصورة أُنشئت ما لم تُرجع الأداة ملف الصورة.",
        "tool": "generate_image",
        "max_tokens": 180,
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
            "runtime_generation_capabilities": {"image": isinstance(CONFIG.get("image_generation"), dict), "audio": False, "video": False},
            "image_generation_assignment": {k: v for k, v in (CONFIG.get("image_generation") or {}).items() if k in {"for_candidate", "model_repo", "studio_api", "expected_checkpoint_sha256"}},
            "generation_note": "Image creation is routed only through this candidate's own dedicated private ModelScope image-weight Studio. Audio/video output are not enabled in this candidate bake-off.",
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

def _decode_gradio_data(raw: str):
    """The payload of a Gradio SSE call result.

    A long generation sends `event: heartbeat` / `generating` frames (data: null or partial values) BEFORE `event: complete`; the answer is the data of the
    `complete` event. Taking the first `data:` line returned null for every slow (image) call, which looked like "completed without an image file".
    """
    event = ""
    complete = None
    last = None
    for line in raw.splitlines():
        if line.startswith("event:"):
            event = line[6:].strip()
            continue
        if not line.startswith("data:"):
            continue
        try:
            value = json.loads(line[5:].strip())
        except Exception:
            continue
        for _ in range(3):
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                    continue
                except Exception:
                    break
            break
        if value is None:
            continue
        if event == "complete":
            complete = value
        last = value
    return complete if complete is not None else last


def _walk_objects(value):
    if isinstance(value, list):
        for item in value:
            yield from _walk_objects(item)
    elif isinstance(value, dict):
        yield value
        for child in value.values():
            if isinstance(child, (dict, list)):
                yield from _walk_objects(child)


def _photo_status(profile: dict, token: str) -> dict:
    base = str(profile.get("studio_api") or "").rstrip("/")
    repo = str(profile.get("model_repo") or "")
    if not base.startswith("https://studio-novaai2026-") or not base.endswith(".api-inference.modelscope.net"):
        raise RuntimeError("Candidate image Studio address is not an approved private ModelScope endpoint.")
    if not repo.startswith("novaai2026/"):
        raise RuntimeError("Candidate image model repo is not in the private ModelScope namespace.")
    start = requests.post(
        base + "/gradio_api/call/status",
        json={"data": []},
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        timeout=(8, 20),
    )
    start.raise_for_status()
    event_id = str((start.json() or {}).get("event_id") or "")
    if not event_id:
        raise RuntimeError("Image Studio status returned no event id.")
    poll = requests.get(
        base + "/gradio_api/call/status/" + event_id,
        headers={"Authorization": "Bearer " + token},
        timeout=(8, 45),
    )
    poll.raise_for_status()
    raw = poll.text
    if "event: error" in raw:
        raise RuntimeError("The candidate's dedicated image Studio returned a status error.")
    payload = _decode_gradio_data(raw)
    items = payload if isinstance(payload, list) else [payload]
    status = next((x for x in _walk_objects(items) if isinstance(x.get("phase"), str)), None)
    if not status or status.get("phase") != "ready":
        raise RuntimeError("Candidate's own image Studio is not ready: " + str((status or {}).get("phase") or "unreadable"))
    actual_repo = str(status.get("model_repo") or status.get("modelscope_model_repo") or "")
    checkpoint_sha = str(status.get("checkpoint_sha256") or "")
    expected_sha = str(profile.get("expected_checkpoint_sha256") or "").lower()
    if actual_repo != repo or not re.fullmatch(r"[a-f0-9]{64}", checkpoint_sha):
        raise RuntimeError("Dedicated image Studio did not prove its assigned model repo and checkpoint SHA-256.")
    if expected_sha and checkpoint_sha.lower() != expected_sha:
        raise RuntimeError("Dedicated image Studio checkpoint hash differs from this candidate's pinned weight.")
    return {"base": base, "model_repo": actual_repo, "checkpoint_sha256": checkpoint_sha}


def _generate_candidate_image(arguments: dict) -> dict:
    profile = CONFIG.get("image_generation")
    route_id = str(CONFIG.get("route_id") or "")
    if not isinstance(profile, dict) or profile.get("for_candidate") != route_id:
        return {"ok": False, "error": "This candidate has no valid, unique image-weight assignment."}
    prompt = str(arguments.get("prompt") or "").strip()
    negative = str(arguments.get("negative_prompt") or "").strip()[:1800]
    if len(prompt) < 8 or len(prompt) > 1800:
        return {"ok": False, "error": "Image prompt must be between 8 and 1800 characters."}
    token = (os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or "").strip()
    if not token:
        return {"ok": False, "error": "The candidate Studio has no ModelScope token for its private image Studio."}
    try:
        proof = _photo_status(profile, token)
        seed = int(arguments.get("seed")) if str(arguments.get("seed", "")).strip() else int(time.time()) % 2147483647
        request_data = [
            prompt,
            negative,
            str(profile.get("resolution") or "512 × 512"),
            int(profile.get("steps") or 25),
            float(profile.get("cfg") or 5.5),
            seed,
        ]
        submit = requests.post(
            proof["base"] + "/gradio_api/call/image",
            json={"data": request_data},
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
            timeout=(8, 30),
        )
        submit.raise_for_status()
        event_id = str((submit.json() or {}).get("event_id") or "")
        if not event_id:
            raise RuntimeError("Image Studio returned no generation event id.")
        result = requests.get(
            proof["base"] + "/gradio_api/call/image/" + event_id,
            headers={"Authorization": "Bearer " + token},
            timeout=(8, 540),
        )
        result.raise_for_status()
        raw = result.text
        if "event: error" in raw or "event: complete" not in raw:
            why = re.sub(r"\s+", " ", raw[-420:]).strip()
            raise RuntimeError("The dedicated image Studio did not complete generation. Its last answer: " + why)
        payload = _decode_gradio_data(raw)
        values = payload if isinstance(payload, list) else [payload]
        objects = list(_walk_objects(values))
        image_file = next((x for x in objects if isinstance(x.get("path"), str) and x.get("path")), None)
        metadata = next((x for x in objects if x.get("result") == "image_generated"), None)
        if not image_file or not metadata:
            raise RuntimeError("Image Studio completed without an image file and generation metadata.")
        if metadata.get("model_repo") != proof["model_repo"] or str(metadata.get("checkpoint_sha256") or "").lower() != proof["checkpoint_sha256"].lower():
            raise RuntimeError("Generated image metadata does not match this candidate's private Studio.")
        relative = str(image_file.get("path") or "").replace("\\", "/")
        marker = "/gradio_api/file="
        if marker in relative:
            relative = relative.split(marker, 1)[1]
        relative = relative.lstrip("/")
        if not relative or ".." in Path(relative).parts or "\x00" in relative or relative.startswith("http"):
            raise RuntimeError("Image Studio returned an unsafe file path.")
        from urllib.parse import quote
        file_response = requests.get(
            proof["base"] + "/gradio_api/file=/" + quote(relative, safe="/"),
            headers={"Authorization": "Bearer " + token},
            timeout=(8, 90),
        )
        file_response.raise_for_status()
        mime = (file_response.headers.get("content-type") or "image/png").split(";", 1)[0].lower()
        image_bytes = file_response.content
        if not mime.startswith("image/") or len(image_bytes) < 1000:
            # one more way to the same file: the absolute URL the Studio itself reported for it, when it points at this Studio's own host
            alt = str(image_file.get("url") or "")
            if alt.startswith(proof["base"] + "/gradio_api/file="):
                again = requests.get(alt, headers={"Authorization": "Bearer " + token}, timeout=(8, 90))
                if again.ok and (again.headers.get("content-type") or "").lower().startswith("image/") and len(again.content) >= 1000:
                    mime, image_bytes = (again.headers.get("content-type") or "image/png").split(";", 1)[0].lower(), again.content
            if not mime.startswith("image/") or len(image_bytes) < 1000:
                head = re.sub(r"\s+", " ", image_bytes[:160].decode("utf-8", errors="replace")).strip()
                raise RuntimeError(f"Candidate image Studio returned an invalid or empty image file (HTTP {file_response.status_code}, {mime}, {len(image_bytes)} bytes, path {relative[:80]!r}, starts: {head[:100]!r}).")
        return {
            "ok": True,
            "message": "Image generated by this candidate's own dedicated image-weight Studio.",
            "_generated_media": {
                "kind": "image",
                "mime": mime,
                "b64": base64.b64encode(image_bytes).decode("ascii"),
                "metadata": metadata,
                "candidate": route_id,
                "model_repo": proof["model_repo"],
                "checkpoint_sha256": proof["checkpoint_sha256"],
                "seed": seed,
                "bytes": len(image_bytes),
            },
        }
    except Exception as exc:
        return {"ok": False, "error": "The selected candidate's own image Studio failed: " + f"{type(exc).__name__}: {str(exc)[:650]}"}


def _approx_tokens(text: str) -> int:
    """A cautious token estimate (Arabic and JSON tokenise densely: about 2.4 characters per token)."""
    return int(len(text) / 2.4) + 1


def _text_tools_system(tools: list) -> str:
    """For a runtime whose chat template cannot take a `tools` list (MiniCPM answered every such request with HTTP 500): the tools are described in
    plain text and the model answers with <tool_call>{...}</tool_call>, which tool_parsing.py already reads. The model still decides when to call."""
    lines = []
    for item in tools:
        fn = item.get("function") or {}
        lines.append("- " + str(fn.get("name")) + ": " + str(fn.get("description") or "")[:260] + " | parameters: " + json.dumps(fn.get("parameters") or {}, ensure_ascii=False)[:420])
    return (
        "You can call these tools when they are needed:\n" + "\n".join(lines) +
        "\nTo call a tool answer ONLY with <tool_call>{\"name\": \"tool_name\", \"arguments\": {...}}</tool_call> and wait for the result. "
        "Never claim a tool ran unless its result was returned to you."
    )


def _text_tool_payload(options: dict, messages: list) -> dict:
    """The same conversation without the `tools` field: tool calls and results become ordinary text turns."""
    wire = []
    for m in messages:
        role = m.get("role")
        if role == "assistant" and m.get("tool_calls"):
            calls = "".join(
                "<tool_call>" + json.dumps({"name": c["function"]["name"], "arguments": c["function"]["arguments"]}, ensure_ascii=False) + "</tool_call>"
                for c in m["tool_calls"]
            )
            wire.append({"role": "assistant", "content": (str(m.get("content") or "") + calls)})
        elif role == "tool":
            wire.append({"role": "user", "content": "[tool result: " + str(m.get("name")) + "]\n" + str(m.get("content") or "")})
        else:
            wire.append({"role": role, "content": m.get("content") if m.get("content") is not None else ""})
    wire.insert(0, {"role": "system", "content": _text_tools_system(options.get("tools") or [])})
    body = {k: v for k, v in options.items() if k not in ("tools", "tool_choice")}
    body["messages"] = wire
    return body


def _fit_tool_result(tool_result, messages: list, options: dict, call_count: int) -> str:
    """A tool result is cut to what the context window still has room for (the prompt, the tool schemas and the answer to come are counted first),
    instead of a fixed 8000 characters that overflows a 2048-token window. The cut keeps the start and the end and says so."""
    text = json.dumps(tool_result, ensure_ascii=False)
    used = sum(_approx_tokens(str(m.get("content") or "")) + 8 for m in messages)
    used += _approx_tokens(json.dumps(options.get("tools") or [], ensure_ascii=False))
    free = N_CTX - used - int(options.get("max_tokens") or 0) - 160
    budget_chars = max(500, int(free * 2.4 / max(1, call_count)))
    budget_chars = min(budget_chars, 8000)
    if len(text) <= budget_chars:
        return text
    head = int(budget_chars * 0.7)
    tail = budget_chars - head - 40
    return text[:head] + " …[cut to fit the context window]… " + text[-max(0, tail):]


def _mentions_script(text: str, executed_tools: list) -> bool:
    """The report names a real package.json script: the word "scripts", or a `"name": "command"` pair that the file-reading tool really returned."""
    if re.search(r"\bscripts?\b|سكربت|أوامر التشغيل", text, flags=re.I):
        return True
    returned = " ".join(json.dumps(t.get("result"), ensure_ascii=False) for t in executed_tools if t.get("name") == "github_read_files")
    for name, command in re.findall(r'"([A-Za-z0-9:_-]{2,30})"\s*:\s*"([^"]{3,120})"', text):
        if command in returned and name in returned:
            return True
    return False


def _merge_tool_schemas(existing: list, loaded: list) -> list:
    """Adds the freshly loaded tool schemas to the bridge tool list (by name, no duplicates, `load_tools` stays first)."""
    seen = {str((t.get("function") or {}).get("name")) for t in existing if isinstance(t, dict)}
    merged = list(existing)
    for t in loaded:
        name = str(((t or {}).get("function") or {}).get("name") or "")
        if name and name not in seen:
            seen.add(name)
            merged.append(t)
    return merged


def _load_tool_groups(arguments: dict, tool_bridge: dict | None) -> dict:
    """`load_tools`: ask the app bridge for the schemas of the requested groups; the next model step sees them."""
    if not isinstance(tool_bridge, dict) or not str(tool_bridge.get("url") or "").startswith("https://"):
        return {"ok": False, "error": "No connector bridge is available for this conversation."}
    groups = arguments.get("groups")
    if not isinstance(groups, list) or not groups:
        return {"ok": False, "error": "Give groups: a list such as [\"github\", \"computer\", \"web\", \"connectors\"]."}
    try:
        response = requests.post(
            str(tool_bridge["url"]),
            json={"ticket": tool_bridge.get("ticket"), "model": tool_bridge.get("model"), "name": "__schemas__", "arguments": {"groups": [str(g) for g in groups][:4]}},
            headers={"Cache-Control": "no-store"},
            timeout=(10, 30),
        )
        payload = response.json() if response.content else {}
        loaded = json.loads(str(payload.get("result") or "[]")) if isinstance(payload, dict) and payload.get("ok") else []
        if not isinstance(loaded, list) or not loaded:
            return {"ok": False, "error": "No tools exist for those groups on this account (github needs a linked GitHub account)."}
        tool_bridge["tools"] = _merge_tool_schemas(tool_bridge.get("tools") or [], loaded)
        return {"ok": True, "loaded": [t["function"]["name"] for t in loaded], "note": "These tools are available from your next step."}
    except Exception as exc:
        return {"ok": False, "error": "Could not load the tool groups: " + str(exc)[:300]}


def _media_profile() -> dict | None:
    conf = CONFIG.get("media_generation")
    if not isinstance(conf, dict) or conf.get("for_candidate") != CONFIG.get("route_id"):
        return None
    base = str(conf.get("studio_api") or "").rstrip("/")
    if not (base.startswith("https://studio-novaai2026-sham-donor-") and base.endswith("-media.api-inference.modelscope.net")):
        return None
    return {"base": base, "media_repo": str(conf.get("media_repo") or "")}


def _generate_candidate_media(kind: str, arguments: dict) -> dict:
    """Audio / video from THIS candidate's own media Studio (its own copy of the weights). Nothing else is ever asked."""
    profile = _media_profile()
    if profile is None or kind not in MEDIA_MIME:
        return {"ok": False, "error": "This candidate has no dedicated media Studio assigned."}
    token = (os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or "").strip()
    if not token:
        return {"ok": False, "error": "The candidate Studio has no ModelScope token for its private media Studio."}
    if kind == "audio":
        text = str(arguments.get("text") or "").strip()
        if len(text) < 2 or len(text) > 1500:
            return {"ok": False, "error": "Text must be between 2 and 1500 characters."}
        api, payload = "speech", {"text": text}
    else:
        prompt = str(arguments.get("prompt") or "").strip()
        if len(prompt) < 4 or len(prompt) > 800:
            return {"ok": False, "error": "Prompt must be between 4 and 800 characters."}
        seconds = int(arguments.get("seconds") or 2)
        api, payload = "video", {"prompt": prompt, "seconds": max(1, min(3, seconds)), "seed": int(time.time()) % 2147483647}
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    try:
        submit = requests.post(profile["base"] + "/gradio_api/call/v2/" + api, json={"body": json.dumps(payload)}, headers=headers, timeout=(8, 30))
        submit.raise_for_status()
        event_id = str((submit.json() or {}).get("event_id") or "")
        if not event_id:
            raise RuntimeError("the media Studio returned no event id")
        result = requests.get(profile["base"] + "/gradio_api/call/" + api + "/" + event_id, headers={"Authorization": "Bearer " + token}, timeout=(8, 600))
        result.raise_for_status()
        raw = result.text
        if "event: error" in raw or "event: complete" not in raw:
            why = re.sub(r"\s+", " ", raw[-420:]).strip()
            raise RuntimeError("the media Studio did not complete. Its last answer: " + why)
        data = _decode_gradio_data(raw)
        item = data[0] if isinstance(data, list) and data else data
        if isinstance(item, str):
            item = json.loads(item)
        if not isinstance(item, dict) or item.get("type") != kind or not item.get("b64"):
            reason = item.get("text") if isinstance(item, dict) else ""
            raise RuntimeError("the media Studio returned no " + kind + " file. " + str(reason or "")[:300])
        raw_bytes = base64.b64decode(str(item["b64"]), validate=True)
        if len(raw_bytes) < 1000 or len(raw_bytes) > 2_600_000:
            raise RuntimeError("the " + kind + " file is empty or larger than the delivery limit (" + str(len(raw_bytes)) + " bytes)")
        return {
            "ok": True,
            "message": kind + " made by this candidate's own dedicated media Studio.",
            "_generated_media": {
                "kind": kind, "mime": MEDIA_MIME[kind], "b64": str(item["b64"]), "bytes": len(raw_bytes),
                "candidate": CONFIG.get("route_id"), "media_repo": profile["media_repo"], "media_studio": profile["base"],
                "prompt": str(payload.get("text") or payload.get("prompt") or "")[:200],
            },
        }
    except Exception as exc:
        return {"ok": False, "error": "The candidate's own media Studio failed: " + f"{type(exc).__name__}: {str(exc)[:600]}"}


def _execute_tool(name: str, arguments: dict, tool_bridge: dict | None = None) -> dict:
    """Execute local public read-only tools or relay linked-account tools through the scoped app bridge."""
    if not isinstance(arguments, dict):
        return {"ok": False, "error": "Tool arguments must be an object."}
    if name == "generate_image":
        return _generate_candidate_image(arguments)
    if name == "load_tools":
        return _load_tool_groups(arguments, tool_bridge)
    if name in MEDIA_TOOLS:
        return _generate_candidate_media("audio" if name == "generate_audio" else "video", arguments)
    bridge_tools = tool_bridge.get("tools") if isinstance(tool_bridge, dict) else []
    remote_names = {
        str(item.get("function", {}).get("name") or "")
        for item in bridge_tools if isinstance(item, dict) and isinstance(item.get("function"), dict)
    }
    if name in remote_names:
        bridge_url = str(tool_bridge.get("url") or "")
        if not bridge_url.startswith("https://") or "/api/coder/app/donor-tools" not in bridge_url:
            return {"ok": False, "error": "The scoped connector bridge URL is invalid."}
        try:
            response = requests.post(
                bridge_url,
                json={
                    "ticket": tool_bridge.get("ticket"),
                    "model": tool_bridge.get("model"),
                    "name": name,
                    "arguments": arguments,
                },
                headers={"Cache-Control": "no-store"},
                timeout=(10, 38),
            )
            payload = response.json() if response.content else {}
            if not isinstance(payload, dict):
                return {"ok": False, "http_status": response.status_code, "error": "Connector bridge returned an invalid response."}
            return {
                "ok": payload.get("ok") is True,
                "result": str(payload.get("result") or payload.get("error") or "")[:18000],
                "approval_required": payload.get("approval_required") is True,
                "http_status": response.status_code,
            }
        except Exception as exc:
            return {"ok": False, "error": "Connector bridge request failed: " + str(exc)[:400]}

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
            for item in items[:60] if isinstance(item, dict)
        ]
        return {"ok": True, "repo": repo, "count": len(files), "files": files}
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
                        selected.update(range(max(0, index - 3), min(len(lines), index + 4)))
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
    tool_bridge: dict | None = None,
) -> dict:
    state = get_state()
    if state["phase"] != "ready":
        return {"error": f"Model not ready: {state['phase']}", "detail": state["error"]}
    try:
        content, media_labels = _build_user_content(prompt, image_path, audio_path, video_path)
        messages = _read_history(history)
        if isinstance(tool_bridge, dict) and tool_bridge.get("connectors"):
            connected = ", ".join(str(x) for x in tool_bridge.get("connectors", []) if isinstance(x, str))
            messages.insert(0, {
                "role": "system",
                "content": (
                    "Connected services available to this selected model: " + connected + ". "
                    "Use connector_api for the user's linked accounts, and use the GitHub-specific tools for authenticated repository work. "
                    "The app server executes those tools using the account's existing permissions; credentials are not present in this Studio. "
                    "Never claim a tool ran unless its returned result confirms it."
                ),
            })
        messages.append({"role": "user", "content": content})
        options = {
            "model": CONFIG.get("id", "isolated-donor"),
            "max_tokens": int(max(16, min(max_tokens, MAX_OUTPUT))),
            "temperature": float(max(0.0, min(CONFIG.get("temperature", 0.2) if temperature is None else temperature, 1.2))),
            "top_p": float(max(0.0, min(CONFIG.get("top_p", 0.9), 1.0))),
        }
        if use_tools:
            by_name = {item["function"]["name"]: item for item in TOOLS}
            if isinstance(CONFIG.get("image_generation"), dict) and CONFIG.get("image_generation", {}).get("for_candidate") == CONFIG.get("route_id"):
                by_name["generate_image"] = IMAGE_GENERATION_TOOL
                messages.insert(0, {"role": "system", "content": "When the user requests image creation, call generate_image using this candidate's own private image Studio. Do not claim success without a returned image."})
            if _media_profile() is not None:
                by_name.update(MEDIA_TOOLS)
                messages.insert(0, {"role": "system", "content": "For speech call generate_audio, for a video clip call generate_video: both run only in this candidate's own media Studio. Do not claim success without a returned file."})
            if isinstance(tool_bridge, dict) and isinstance(tool_bridge.get("tools"), list):
                for item in tool_bridge["tools"]:
                    if isinstance(item, dict) and isinstance(item.get("function"), dict) and item["function"].get("name"):
                        by_name[str(item["function"]["name"])] = item
            options["tools"] = list(by_name.values())
            options["tool_choice"] = "auto"
        started = time.monotonic()
        token_count = 0
        executed_tools = []
        generated_media = []
        pending_calls = []
        text_tool_mode = False
        choice_item = {}
        choice = {}
        # The model chooses when and which tool to call. Only allowlisted read-only
        # tools execute here; their real results are fed back to the model.
        for tool_round in range(4):
            response = requests.post(
                SERVER_BASE + "/v1/chat/completions",
                json=_text_tool_payload(options, messages) if text_tool_mode else {**options, "messages": messages},
                timeout=(10, 240),
            )
            if response.status_code >= 500 and options.get("tools") and not text_tool_mode:
                text_tool_mode = True      # this runtime's chat template cannot take a tools list: describe the tools in text instead
                response = requests.post(SERVER_BASE + "/v1/chat/completions", json=_text_tool_payload(options, messages), timeout=(10, 240))
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
                tool_result = _execute_tool(name, arguments, tool_bridge)
                generated = tool_result.pop("_generated_media", None) if isinstance(tool_result, dict) else None
                if isinstance(generated, dict):
                    generated_media.append(generated)
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
                    "content": _fit_tool_result(tool_result, messages, options, len(calls)),
                })
            assistant_content = str(choice.get("content") or "")
            assistant_content = strip_tool_call_markup(assistant_content)
            messages.append({"role": "assistant", "content": assistant_content or None, "tool_calls": assistant_calls})
            messages.extend(tool_results)
            if use_tools and isinstance(tool_bridge, dict) and isinstance(tool_bridge.get("tools"), list):
                for item in tool_bridge["tools"]:      # tools loaded by load_tools in this round are shown from the next one
                    if isinstance(item, dict) and isinstance(item.get("function"), dict) and item["function"].get("name"):
                        by_name[str(item["function"]["name"])] = item
                options["tools"] = list(by_name.values())
        elapsed = time.monotonic() - started
        output = str(choice.get("content") or "")
        if pending_calls or executed_tools:
            output = strip_tool_call_markup(output)
        return {
            "text": output,
            "tool_calls": pending_calls,
            "executed_tools": executed_tools,
            "generated_media": generated_media,
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

def _deliver_candidate_result(tool_bridge: dict | None, result: dict, prompt: str) -> tuple[bool, str]:
    if not isinstance(tool_bridge, dict):
        return False, "no signed owner task ticket"
    ticket = str(tool_bridge.get("ticket") or "")
    model = str(tool_bridge.get("model") or "")
    run_id = str(tool_bridge.get("run_id") or "")
    bot_id = str(tool_bridge.get("bot_id") or "")
    bridge_url = str(tool_bridge.get("url") or "").rstrip("/")
    if not ticket or model != str(CONFIG.get("route_id") or "") or not run_id or not bot_id:
        return False, "no valid candidate-scoped delivery ticket"
    suffix = "/api/coder/app/donor-tools"
    if not bridge_url.startswith("https://") or not bridge_url.endswith(suffix):
        return False, "candidate delivery bridge URL is invalid"
    callback_url = bridge_url[:-len("donor-tools")] + "donor-media"
    outgoing_media = []
    for item in (result.get("generated_media") or [])[:2]:
        if not isinstance(item, dict) or item.get("candidate") != model:
            continue
        if item.get("kind") in MEDIA_MIME:
            if len(str(item.get("b64") or "")) > 3_600_000:
                return False, "the " + str(item.get("kind")) + " is larger than the signed callback transfer limit"
            outgoing_media.append(dict(item))
            continue
        try:
            image_bytes = base64.b64decode(str(item.get("b64") or ""), validate=True)
            from PIL import Image
            from io import BytesIO
            image = Image.open(BytesIO(image_bytes)).convert("RGB")
            output = BytesIO()
            image.save(output, format="JPEG", quality=84, optimize=True)
            jpeg = output.getvalue()
            if len(jpeg) > 2_800_000:
                output = BytesIO()
                image.save(output, format="JPEG", quality=76, optimize=True)
                jpeg = output.getvalue()
            if len(jpeg) > 3_000_000 or len(jpeg) < 1000:
                raise ValueError("compressed image exceeds the signed callback transfer limit")
            outgoing = dict(item)
            outgoing["mime"] = "image/jpeg"
            outgoing["b64"] = base64.b64encode(jpeg).decode("ascii")
            outgoing["bytes"] = len(jpeg)
            outgoing_media.append(outgoing)
        except Exception as exc:
            return False, "generated image could not be prepared for secure Telegram delivery: " + str(exc)[:300]
    try:
        response = requests.post(
            callback_url,
            json={
                "ticket": ticket,
                "model": model,
                "run_id": run_id,
                "bot_id": bot_id,
                "prompt": str(prompt or "")[:12000],
                "text": str(result.get("text") or "")[:12000],
                "generated_media": outgoing_media,
            },
            headers={"Cache-Control": "no-store"},
            timeout=(8, 28),
        )
        payload = response.json() if response.content else {}
        if response.status_code != 200 or not isinstance(payload, dict) or payload.get("ok") is not True or payload.get("delivered") is not True:
            detail = payload.get("error") if isinstance(payload, dict) else "invalid callback response"
            return False, "Telegram delivery callback refused the result: " + str(detail or response.status_code)[:350]
        return True, ""
    except Exception as exc:
        return False, "Telegram delivery callback failed: " + f"{type(exc).__name__}: {str(exc)[:300]}"


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
        bridge = payload.get("tool_bridge") if isinstance(payload.get("tool_bridge"), dict) else None
        result = infer(
            str(payload.get("prompt") or "حلّل المرفق."),
            history=history,
            max_tokens=int(payload.get("max_tokens") or MAX_OUTPUT),
            temperature=payload.get("temperature"),
            use_tools=bool(payload.get("use_tools", True)),
            tool_bridge=bridge,
            image_path=paths["image_path"],
            audio_path=paths["audio_path"],
            video_path=paths["video_path"],
        )
        if "error" not in result and bridge:
            delivered, delivery_error = _deliver_candidate_result(bridge, result, str(payload.get("prompt") or ""))
            result["delivered_to_telegram"] = delivered
            if delivered:
                # The signed callback has already delivered the final text and image. Do not
                # send another copy if the original bot request is still alive.
                result["generated_media"] = []
            elif delivery_error:
                result["delivery_callback_error"] = delivery_error
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

def _run_direct_tool(test: dict) -> dict:
    """Runs one generation tool by itself (no model turns): the call to the candidate's OWN image / media Studio is what is checked, so a slow
    model cannot push the test past the gateway's stream limit. The file must be real: a valid image, a WAV with sound, an MP4 with motion."""
    name = str(test["direct_tool"])
    started = time.monotonic()
    if name in MEDIA_TOOLS and _media_profile() is None:
        return _unsupported(test, "this candidate has no dedicated media Studio assigned.")
    result = _execute_tool(name, dict(test.get("direct_args") or {}), None)
    seconds = round(time.monotonic() - started, 2)
    generated = result.pop("_generated_media", None) if isinstance(result, dict) else None
    out = {"id": test["id"], "label": test["label"], "check_type": "direct_tool", "seconds": seconds, "tool": name, "tool_result": result, "generated_media": []}
    if not isinstance(generated, dict):
        out["passed"] = False
        return out
    problem = ""
    try:
        raw = base64.b64decode(str(generated.get("b64") or ""), validate=True)
        kind = str(generated.get("kind"))
        if kind == "image":
            from PIL import Image
            from io import BytesIO
            im = Image.open(BytesIO(raw)).convert("RGB")
            colors = len(set(im.resize((64, 64)).getdata()))
            if colors < 200:
                problem = f"image has only {colors} distinct colours (blank / noise?)"
        elif kind == "audio":
            with wave.open(__import__("io").BytesIO(raw)) as w:
                frames = w.readframes(w.getnframes())
                if w.getnframes() / max(1, w.getframerate()) < 0.5 or not any(frames[:200000]):
                    problem = "audio is shorter than 0.5 s or silent"
        elif kind == "video":
            if raw[4:8] != b"ftyp":
                problem = "not an MP4 file"
    except Exception as exc:
        problem = f"file could not be checked: {type(exc).__name__}: {str(exc)[:120]}"
    out["generated_media"] = [generated]
    out["problem"] = problem
    out["passed"] = bool(result.get("ok")) and not problem
    return out


def _run_one(test: dict) -> dict:
    if test.get("direct_tool"):
        try:
            return _run_direct_tool(test)
        except Exception as exc:
            return {"id": test["id"], "label": test["label"], "passed": False, "error": f"{type(exc).__name__}: {str(exc)[:300]}"}
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
            "generate_image": {},
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
        generation_ok = True
        generation_summary = []
        if test["id"] == "image_generation":
            generation_ok = False
            output_dir = RUNTIME / "generated-smoke-images"
            output_dir.mkdir(parents=True, exist_ok=True)
            for item in (result.get("generated_media") or []):
                if not isinstance(item, dict) or item.get("candidate") != CONFIG.get("route_id"):
                    continue
                try:
                    image_bytes = base64.b64decode(str(item.get("b64") or ""), validate=True)
                except Exception:
                    continue
                metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
                if len(image_bytes) < 1000 or metadata.get("result") != "image_generated" or metadata.get("model_repo") != item.get("model_repo") or metadata.get("checkpoint_sha256") != item.get("checkpoint_sha256"):
                    continue
                filename = "image-" + str(CONFIG.get("route_id")) + "-" + str(int(time.time())) + ".png"
                target = output_dir / filename
                target.write_bytes(image_bytes)
                generation_summary.append({"filename": filename, "bytes": len(image_bytes), "candidate": item.get("candidate"), "model_repo": item.get("model_repo"), "checkpoint_sha256": item.get("checkpoint_sha256"), "seed": item.get("seed")})
                generation_ok = True
                break
            result["generation_outputs"] = generation_summary
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
                and _mentions_script(text, executed)
            )
        elif test["id"] == "image_generation":
            passed = tool_ok and generation_ok and bool(text.strip())
        elif expected_tools:
            passed = tool_ok and bool(text.strip())
        elif test["id"] == "arabic":
            passed = arabic_chars >= 35 and not refusal
        elif test["id"] == "reasoning_visibility":
            leaked = bool(re.search(r"<think>|</think>|here(?:'s| is) (?:my )?thinking process|analyze the input|determine the persona", text, flags=re.I))
            passed = bool(text.strip()) and arabic_chars >= 8 and not leaked
        elif test["id"] == "code":
            passed = ("def " in text or "def\t" in text) and "assert " in text and not refusal
        elif media_kind:
            # This checks media ingestion + model completion only; semantic quality
            # still requires review against the rendered media in the private Studio.
            passed = bool(text.strip())
        else:
            passed = not refusal
        return {
            "id": test["id"],
            "label": test["label"],
            "passed": bool(passed),
            "check_type": "media_pipeline_only" if media_kind else ("executed_tool_loop" if expected_tools else "heuristic_smoke"),
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
        "note": "Image generation uses only this candidate's dedicated private ModelScope image Studio. The tool result is verified against that candidate's model repo and checkpoint hash. Audio/video output are not enabled here.",
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
        "generated_media": [{k: v for k, v in item.items() if k != "b64"} for item in (result.get("generated_media") or [])],
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
