"""Isolated ModelScope donor evaluation UI. This app never imports or calls Sham, Nova, GitHub, or Vercel credentials."""
from __future__ import annotations
import json
import os
import re
import threading
import time
from pathlib import Path

import gradio as gr
from huggingface_hub import hf_hub_download
from llama_cpp import Llama

CONFIG_PATH = Path(__file__).with_name("candidate.json")
CONFIG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
STATE = {
    "phase": "loading",
    "error": None,
    "model": None,
    "model_path": None,
    "load_seconds": None,
    "started_at": time.time(),
    "candidate": CONFIG.get("label", CONFIG.get("id", "unknown")),
}
LOCK = threading.Lock()
THREADS = max(2, min(int(os.cpu_count() or 4), 4))
N_CTX = int(os.environ.get("DONOR_N_CTX", "4096"))

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
            "name": "vercel_deployment_status",
            "description": "Read-only check of a Vercel project's latest deployment status.",
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
        "max_tokens": 220,
        "temperature": 0.2,
    },
    {
        "id": "code",
        "label": "الكود",
        "prompt": "اكتب دالة Python تجمع قائمة أعداد صحيحة، وتتعامل مع القائمة الفارغة والأعداد السالبة، ثم أضف ثلاثة اختبارات assert. أعط كوداً صحيحاً فقط.",
        "max_tokens": 300,
        "temperature": 0.15,
    },
    {
        "id": "benign_no_overrefusal",
        "label": "طلب سليم وعدم الرفض الزائد",
        "prompt": "اكتب برنامج Python للقراءة فقط يحصي الملفات حسب الامتداد داخل مجلد ويطبع تقريراً. لا يعدل أي ملف ولا يحذفه.",
        "max_tokens": 260,
        "temperature": 0.15,
    },
    {
        "id": "github_tool",
        "label": "أداة GitHub",
        "prompt": "أريد فحص المستودع jonsnow-org/Ttbik ومعرفة أسماء الملفات في جذره. استدعِ أداة github_repo_scan الآن لجلب المعلومات بدلاً من تخمينها.",
        "tool": "github_repo_scan",
        "max_tokens": 160,
        "temperature": 0.0,
    },
    {
        "id": "vercel_tool",
        "label": "أداة Vercel",
        "prompt": "تحقق من حالة أحدث عملية نشر لمشروع Vercel المسمى ttbik. استدعِ أداة vercel_deployment_status باسم المشروع ttbik؛ لا تخمّن الحالة.",
        "tool": "vercel_deployment_status",
        "max_tokens": 160,
        "temperature": 0.0,
    },
]

def load_model() -> None:
    started = time.monotonic()
    try:
        local_dir = str(Path(__file__).with_name("model_cache"))
        configured_endpoint = os.environ.get("DONOR_HF_ENDPOINT") or os.environ.get("HF_ENDPOINT")
        endpoints = []
        for endpoint in (configured_endpoint, "https://hf-mirror.com", "https://huggingface.co"):
            if endpoint and endpoint.rstrip("/") not in endpoints:
                endpoints.append(endpoint.rstrip("/"))
        download_errors = []
        model_path = None
        for endpoint in endpoints:
            try:
                print(f"Trying candidate download endpoint: {endpoint}", flush=True)
                model_path = hf_hub_download(
                    repo_id=CONFIG["repo_id"],
                    filename=CONFIG["filename"],
                    local_dir=local_dir,
                    endpoint=endpoint,
                    etag_timeout=5,
                )
                break
            except Exception as download_exc:
                detail = f"{endpoint}: {type(download_exc).__name__}: {str(download_exc)[:450]}"
                download_errors.append(detail)
                print(f"Candidate download endpoint failed: {detail}", flush=True)
        if not model_path:
            raise RuntimeError("Could not download candidate from any configured Hugging Face endpoint. " + " | ".join(download_errors))
        model = Llama(
            model_path=model_path,
            n_ctx=N_CTX,
            n_threads=THREADS,
            n_batch=128,
            n_gpu_layers=0,
            use_mmap=True,
            use_mlock=False,
            verbose=False,
        )
        # Force a small real inference so startup is not declared successful merely because
        # the GGUF file opened; all model-specific errors are reported in the status API.
        probe = model.create_chat_completion(
            messages=[{"role": "user", "content": "Reply with the single word READY."}],
            max_tokens=8,
            temperature=0.0,
        )
        if not isinstance(probe, dict) or not (probe.get("choices") or []):
            raise RuntimeError("The model loaded but failed the inference warm-up")
        with LOCK:
            STATE.update({
                "phase": "ready",
                "error": None,
                "model": model,
                "model_path": model_path,
                "load_seconds": round(time.monotonic() - started, 2),
            })
    except Exception as exc:
        with LOCK:
            STATE.update({
                "phase": "error",
                "error": f"{type(exc).__name__}: {str(exc)[:1600]}",
                "load_seconds": round(time.monotonic() - started, 2),
            })

def get_model():
    with LOCK:
        return STATE["model"], STATE["phase"], STATE["error"]

def status() -> str:
    with LOCK:
        payload = {
            "phase": STATE["phase"],
            "candidate": STATE["candidate"],
            "repo_id": CONFIG.get("repo_id"),
            "filename": CONFIG.get("filename"),
            "backend": "llama.cpp / CPU",
            "context_tokens": N_CTX,
            "threads": THREADS,
            "load_seconds": STATE["load_seconds"],
            "error": STATE["error"],
        }
    return json.dumps(payload, ensure_ascii=False)

def infer(prompt: str, max_tokens: int = 256, temperature: float = 0.2, use_tools: bool = False, history: list | None = None) -> dict:
    model, phase, error = get_model()
    if phase != "ready" or model is None:
        return {"error": f"Model not ready: {phase}", "detail": error}
    messages = []
    for item in (history or [])[-12:]:
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
            continue
        content = item.get("content")
        if isinstance(content, str) and content.strip():
            messages.append({"role": item["role"], "content": content[:4000]})
    messages.append({"role": "user", "content": str(prompt)[:12000]})
    options = {
        "messages": messages,
        "max_tokens": int(max(16, min(max_tokens, 768))),
        "temperature": float(max(0.0, min(temperature, 1.2))),
        "top_p": 0.9,
    }
    if use_tools:
        options["tools"] = TOOLS
        options["tool_choice"] = "auto"
    started = time.monotonic()
    response = model.create_chat_completion(**options)
    elapsed = time.monotonic() - started
    choice = ((response.get("choices") or [{}])[0].get("message") or {})
    calls = choice.get("tool_calls") or []
    parsed_calls = []
    for call in calls:
        fn = call.get("function") or {}
        args = fn.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {"_invalid_json": args}
        parsed_calls.append({"name": fn.get("name"), "arguments": args})
    usage = response.get("usage") or {}
    token_count = int(usage.get("completion_tokens") or 0)
    output = str(choice.get("content") or "")
    return {
        "text": output,
        "tool_calls": parsed_calls,
        "seconds": round(elapsed, 2),
        "completion_tokens": token_count,
        "tokens_per_second": round(token_count / max(elapsed, 0.01), 2),
        "finish_reason": (response.get("choices") or [{}])[0].get("finish_reason"),
    }

def _run_one(test: dict) -> dict:
    try:
        result = infer(
            test["prompt"],
            max_tokens=test["max_tokens"],
            temperature=test["temperature"],
            use_tools=bool(test.get("tool")),
        )
        if "error" in result:
            return {"id": test["id"], "label": test["label"], "passed": False, **result}
        text = result.get("text") or ""
        calls = result.get("tool_calls") or []
        expected_tool = test.get("tool")
        target = "jonsnow-org/Ttbik" if test["id"] == "github_tool" else "ttbik"
        tool_ok = (not expected_tool) or any(
            call.get("name") == expected_tool
            and (
                (test["id"] == "github_tool" and call.get("arguments", {}).get("repo") == target)
                or (test["id"] == "vercel_tool" and call.get("arguments", {}).get("project") == target)
            )
            for call in calls
        )
        arabic_chars = len(re.findall(r"[\u0600-\u06FF]", text))
        letters = len(re.findall(r"[^\W\d_]", text, flags=re.UNICODE))
        refusal = bool(re.search(
            r"لا أستطيع|لا يمكنني مساعدتك|لا يمكنني تنفيذ|غير قادر على|I cannot help|I can't help|unable to assist",
            text,
            flags=re.I,
        ))
        passed = tool_ok if expected_tool else (not refusal)
        if test["id"] == "arabic":
            passed = arabic_chars >= 35 and not refusal
        elif test["id"] == "code":
            passed = ("def " in text or "def\t" in text) and "assert " in text and not refusal
        return {
            "id": test["id"],
            "label": test["label"],
            "passed": bool(passed),
            "arabic_chars": arabic_chars,
            "arabic_letter_ratio": round(arabic_chars / max(letters, 1), 3),
            "refusal_heuristic": refusal,
            **result,
        }
    except Exception as exc:
        return {"id": test["id"], "label": test["label"], "passed": False,
                "error": f"{type(exc).__name__}: {str(exc)[:1200]}"}

def smoke_suite() -> str:
    model, phase, error = get_model()
    if phase != "ready" or model is None:
        return json.dumps({"phase": phase, "error": error, "candidate": STATE["candidate"]}, ensure_ascii=False, indent=2)
    started = time.monotonic()
    results = [_run_one(test) for test in TESTS]
    payload = {
        "candidate": CONFIG["label"],
        "repo_id": CONFIG["repo_id"],
        "phase": "complete",
        "context_tokens": N_CTX,
        "elapsed_seconds": round(time.monotonic() - started, 2),
        "results": results,
        "passed": sum(1 for result in results if result.get("passed")),
        "total": len(results),
        "note": "Connector tests validate model-generated tool-call structure only. No GitHub/Vercel credential or API call is made from this isolated experiment.",
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)

def chat_ui(prompt: str, history_json: str = "[]", use_tools: bool = True) -> str:
    if not str(prompt or "").strip():
        return json.dumps({"text": "اكتب سؤالاً للاختبار.", "tool_calls": []}, ensure_ascii=False)
    try:
        history = json.loads(history_json or "[]")
        if not isinstance(history, list):
            history = []
    except Exception:
        history = []
    result = infer(prompt, history=history, use_tools=bool(use_tools))
    return json.dumps(result, ensure_ascii=False, indent=2)

demo = gr.Blocks(title="Isolated Donor Bake-off")
with demo:
    gr.Markdown(
        "# اختبار مانح مستقل لشام v2\n"
        "هذه بيئة مقارنة معزولة؛ لا تتصل بشام الحالي أو نوفا أو شام v2 الإنتاجي. "
        "اختبارات GitHub وVercel تتحقق من استدعاء الأداة الذي يولّده النموذج فقط ولا تنفّذ أي عملية."
    )
    gr.Markdown("**المرشح:** " + str(CONFIG.get("label")) + "  \n"
                "**المصدر:** " + str(CONFIG.get("repo_id")) + "  \n"
                "**النسخة:** " + str(CONFIG.get("filename")))
    with gr.Row():
        state_box = gr.Textbox(label="حالة التحميل", value=status(), lines=4, interactive=False)
        refresh = gr.Button("تحديث الحالة")
    refresh.click(status, inputs=[], outputs=state_box, api_name="status")
    run_all = gr.Button("تشغيل اختبارات العربية والكود والأدوات", variant="primary")
    suite_box = gr.Textbox(label="تقرير الاختبار", lines=25, interactive=False)
    run_all.click(smoke_suite, inputs=[], outputs=suite_box, api_name="smoke_suite")
    prompt_box = gr.Textbox(label="رسالة اختبار حرة", lines=4, placeholder="اكتب بالعربية أو اطلب كوداً.")
    history_box = gr.Textbox(label="سياق المرشح", value="[]", visible=False)
    tools_box = gr.Checkbox(label="مخطط استدعاء الأدوات (دون تنفيذ)", value=True, visible=False)
    chat_btn = gr.Button("اختبار رد النموذج")
    chat_output = gr.Textbox(label="الرد وقياس السرعة واستدعاءات الأدوات المقترحة", lines=12, interactive=False)
    chat_btn.click(chat_ui, inputs=[prompt_box, history_box, tools_box], outputs=chat_output, api_name="chat")
    demo.load(status, inputs=[], outputs=state_box)

threading.Thread(target=load_model, daemon=True, name="donor-model-loader").start()
if __name__ == "__main__":
    demo.queue(max_size=16).launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", "7860")))
