"""
Nova AI — self-hosted inference server (vision + text, our own trained
Qwen2.5-VL-7B, served as GGUF+mmproj via llama.cpp).

Owner report, 2026-09-07: switched MODEL_ID below from the small
Qwen2.5-0.5B placeholder (used only to prove the deploy pipeline works
end to end) to our own trained nova-vision-7b GGUF repo, per explicit
owner instruction to keep the original 7B capacity and never drop
vision support.

Why the `JamePeng/llama-cpp-python` fork instead of plain
`llama-cpp-python` from PyPI: checked live (2026-09-07) — the official
PyPI package has no chat handler at all for the Qwen2.5-VL family.
JamePeng's fork adds `Qwen25VLChatHandler`, which is what actually
loads the two GGUF files below (main model + mmproj) together and
knows how to feed an image into Qwen2.5-VL's own prompt format.

Owner report, 2026-09-07 (installation): `git+https://github.com/...`
in requirements.txt fails here — ModelScope's build network can't
reach github.com, and public mirror proxies (mirror.ghproxy.com) don't
even resolve from it either. Confirmed live in this Studio's own build
log. Building a matching wheel elsewhere and installing it locally
also can't go through requirements.txt: ModelScope's own Dockerfile
runs `pip install -r requirements.txt` in a build stage *before* the
project's own files (this one included) are copied into the image, so
a wheel we upload alongside app.py doesn't exist yet at that point.
The only place left where the wheel is actually present is at
container *start*, once studio-launcher has already copied everything
in — so we install it right here, at runtime, from a .whl file
uploaded alongside this script (see ai-system/colab notebook comments
for how that wheel was built, matching this container's Python 3.12 /
Ubuntu 22.04 / glibc 2.35 exactly, on Kaggle — not on an arbitrary
newer host, since a wheel linked against a newer glibc would fail to
load here with a "GLIBC_X.XX not found" error, confirmed as a real
failure mode while investigating this).

Deployment mechanism: this whole directory
(ai-system/modelscope-studio/) is pushed to this Studio's own Git
remote automatically by .github/workflows/deploy-modelscope-studio.yml
whenever it changes on this branch — GitHub Actions' own network can
reach modelscope.cn even though neither this development sandbox nor
ModelScope's own build network can reach github.com. No more manual
phone uploads for this Studio.

Why two separate GGUF files: Qwen2.5-VL isn't one self-contained GGUF
like a text-only model — `convert_hf_to_gguf.py` (llama.cpp's own,
official tool) has to be run twice on the trained checkpoint: once for
the text backbone, once with --mmproj for the vision projector. Both
are required together at load time. See
ai-system/colab/merge_and_finetune.ipynb (cells 9-11) for exactly how
these two files were produced and uploaded here.

Image input is a plain base64 string in a second Textbox
(`image_base64`), NOT a gr.Image component. Deliberate choice: we
already have hard, confirmed-live evidence that a Textbox's
string<->JSON-value mapping works over Gradio's raw
/gradio_api/call/v2/<api_name> API (that's exactly how the "message"
param already works from council.py). gr.Image would instead need us
to *guess* Gradio's internal file/blob upload JSON shape for this
Gradio version over that same raw API — untested, undocumented here,
and exactly the kind of guess we were told never to ship without
testing. An empty string means "no image" (plain text turn).

Everything else below (ModelScope-hub download instead of HF,
no_proxy fix for Gradio's localhost self-check, plain gr.Interface
instead of ChatInterface, try/except-with-traceback) is unchanged from
the placeholder version that was already confirmed working end to end
— see git history / ai-system/app/council.py's module docstring for
why each of those exists.
"""
import base64
import glob
import json
import os
import re
import subprocess
import sys
import traceback

import requests

os.environ["no_proxy"] = "127.0.0.1,localhost"
os.environ["NO_PROXY"] = "127.0.0.1,localhost"

# تثبيت وقت التشغيل، لا وقت البناء — انظر الشرح أعلى الملف. نبحث عن
# ملف .whl مرفوع بجانب هذا الملف بالضبط (اسمه يبدأ بـllama_cpp_python)
# ونثبّته إن لم تكن llama_cpp مثبَّتة أصلاً بعد.
try:
    import llama_cpp  # noqa: F401
except ImportError:
    _here = os.path.dirname(os.path.abspath(__file__))
    _wheels = glob.glob(os.path.join(_here, "llama_cpp_python-*.whl"))
    if not _wheels:
        raise RuntimeError(
            "ملف llama_cpp_python-*.whl غير موجود بجانب app.py — يجب رفعه أولاً (انظر تعليمات الدفتر)."
        )
    # --no-index --find-links يجعل pip يحل كل الاعتماديات (numpy,
    # pillow, jinja2, diskcache, ...) من ملفات .whl المرفوعة محلياً بجانب
    # app.py فقط، دون أي حاجة لاتصال إنترنت وقت التشغيل — كلها موجودة
    # هنا لأنها بُنيت معاً على Kaggle في نفس الخطوة.
    subprocess.check_call([
        sys.executable, "-m", "pip", "install", "--no-cache-dir",
        "--no-index", "--find-links", _here,
        _wheels[0],
    ])

import gradio as gr
from modelscope import snapshot_download

# Our own trained model repo on ModelScope — produced by
# ai-system/colab/merge_and_finetune.ipynb, NOT a third-party model.
# Update this string (and redeploy) whenever a fresh weekly training
# run prints a new repo name at the end of the notebook.
MODEL_ID = "novaai2026/nova-vision-7b-gguf"
MAIN_GGUF_HINT = "q4_k_m.gguf"
MMPROJ_HINT = "mmproj"

model_dir = snapshot_download(MODEL_ID)
all_gguf = glob.glob(os.path.join(model_dir, "*.gguf"))
main_candidates = [f for f in all_gguf if MAIN_GGUF_HINT in f.lower() and MMPROJ_HINT not in f.lower()]
mmproj_candidates = [f for f in all_gguf if MMPROJ_HINT in f.lower()]
MODEL_PATH = main_candidates[0] if main_candidates else [f for f in all_gguf if MMPROJ_HINT not in f.lower()][0]
MMPROJ_PATH = mmproj_candidates[0] if mmproj_candidates else None

from llama_cpp import Llama
from llama_cpp.llama_chat_format import Qwen25VLChatHandler

# Owner report, 2026-09-08: ModelScope's own build log calls this box
# "2 vCPU", but hardcoding n_threads=2 leaves free capacity on the
# table if the actual container ever has more — os.cpu_count() reads
# what's really available at runtime instead of guessing. n_batch=1024
# (up from llama.cpp's own default 512) and flash_attn=True are both
# pure speed levers — neither changes the model's weights, precision,
# or capacity, so neither is the "shrink the model" the owner has
# repeatedly and explicitly forbidden.
_n_threads = os.cpu_count() or 2

chat_handler = Qwen25VLChatHandler(mmproj_path=MMPROJ_PATH) if MMPROJ_PATH else None
llm = Llama(
    model_path=MODEL_PATH,
    chat_handler=chat_handler,
    n_ctx=4096,
    n_threads=_n_threads,
    n_threads_batch=_n_threads,
    n_batch=1024,
    flash_attn=True,
)

# Owner spec, 2026-09-08: whoever asks "who made/owns/develops you" must
# always get this exact story — no owner/company, one father, the
# Syrian developer — regardless of phrasing or language, and never a
# mention of the underlying base model's own training origin. Sent as a
# real system message on every single call (text AND vision) since
# plain-text calls here previously carried NO system message at all
# (confirmed live in this Studio's own runtime log: a bare "مرحبا من
# انت" produced zero <|im_start|>system turn), so the model answered
# such questions from its own base-model knowledge instead of ours.
#
# Owner report, 2026-09-08 (real Telegram evidence): even with the
# system prompt above, a plain 7B model does NOT reliably hold this one
# fact across different phrasings of the same question — confirmed
# live: "من انت" answered generically, then "لأي شركة أنت مملوك" in the
# very same conversation answered "أنا ملك لشركة Nova", flatly
# contradicting the instruction. Small-model instruction-following on a
# single abstract rule is known to be inconsistent, and the owner's
# requirement here is explicit 100% consistency ("regardless of
# phrasing... however hard they're pressed") — that can only be
# guaranteed deterministically, not by hoping the model obeys. So
# identity questions are now intercepted by keyword match BEFORE the
# model ever runs, and answered with a fixed string every time — the
# system prompt below stays as a second line of defense for phrasings
# the keyword list doesn't catch.
_IDENTITY_KEYWORDS = [
    "من طورك", "من طوّرك", "من صنعك", "من صمّمك", "من صممك", "من برمجك",
    "من انشأك", "من أنشأك", "من يملكك", "من مالكك", "لمن تنتمي", "أي شركة",
    "اي شركة", "الشركة المسؤولة", "من المسؤول عنك", "مطورك", "مالكك",
    "شركتك", "مين سواك", "مين طورك", "مين صنعك", "مين مطورك", "شركة نوفا",
    "who made you", "who created you", "who developed you", "who owns you",
    "who built you", "what company", "which company", "your creator",
    "your developer", "your owner", "your maker",
    # owner report, 2026-09-08: a real Telegram conversation showed "من
    # انت" (a plain "who are you") slipping past the guard entirely and
    # going straight to the model, since that phrasing never mentions
    # "developer/owner/company" — it's the single most common way a user
    # actually opens an identity question, so it has to be caught here
    # too, not just its narrower "who made you" variants.
    "من انت", "من أنت", "مين انت", "مين أنت", "منانت", "من هو نوفا",
    "ما هو نوفا", "عرف عن نفسك", "عرّف عن نفسك", "عرفني بنفسك",
    "عرّفني بنفسك", "حدثني عن نفسك", "من انتي",
    "who are you", "what are you", "tell me about yourself",
    "introduce yourself",
]

_IDENTITY_ANSWER = (
    "ليس لديّ مالك ولا شركة، بل والد واحد فقط هو من ابتكرني وطوّرني، وهو "
    "المطوّر السوري، وقد صممني لأحلّق في فضاء سوريا والعالم."
)


def _is_identity_question(message: str) -> bool:
    normalized = message.strip().lower()
    return any(keyword.lower() in normalized for keyword in _IDENTITY_KEYWORDS)


# Owner spec, 2026-09-08 ("خلايا الاتصال عبر ترومنيل بالمواقع وال آبي
# أي كما تفعل انت"): real, model-initiated tool use, not just rag.py's
# router pre-deciding to search before the model ever runs. Trained
# into the model via ai-system/colab/merge_and_finetune.ipynb's
# tool-use cell (same Hermes-style <tool_call>/<tool_response> format,
# same two tools, same wttr.in/ddgs executors — kept in lockstep with
# that cell so what's trained matches what's served). generate() below
# NEVER trusts a <tool_response> the model itself might produce in one
# pass (it's told explicitly not to and to stop right after the call)
# — it always does a real second generation pass fed the ACTUAL
# executed result, exactly like the training data was built.
_TOOLS_SCHEMA = [
    {
        "name": "web_search",
        "description": "ابحث على الويب عن معلومة حديثة أو حقيقة عامة لا تعرفها بثقة.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "نص البحث"}},
            "required": ["query"],
        },
    },
    {
        "name": "get_weather",
        "description": "احصل على حالة الطقس الحالية لمدينة معيّنة.",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "اسم المدينة بالإنجليزية"}},
            "required": ["city"],
        },
    },
]

_TOOL_CALL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)


def _tool_web_search(query: str) -> str:
    try:
        from ddgs import DDGS

        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=3))
        return "\n".join(f"- {r.get('title', '')}: {r.get('body', '')}" for r in results) or "لا نتائج بحث."
    except Exception as e:
        return f"تعذّر تنفيذ البحث فعلياً: {e}"


def _tool_get_weather(city: str) -> str:
    try:
        resp = requests.get(f"https://wttr.in/{city}?format=3", timeout=15)
        return resp.text.strip() if resp.ok else "تعذّر جلب الطقس."
    except Exception as e:
        return f"تعذّر جلب الطقس فعلياً: {e}"


_TOOL_EXECUTORS = {"web_search": _tool_web_search, "get_weather": _tool_get_weather}


NOVA_SYSTEM_PROMPT = (
    "أنت نوفا NOVA، مساعد ذكاء اصطناعي متعدد اللغات ومتعدد الوسائط (نص وصور). "
    "إن سألك أحد عمّن طوّرك أو صنعك أو يملكك أو عن الشركة أو المختبر المسؤول عنك أو عن النموذج الأساسي "
    "الذي بُنيت عليه، أجب دائماً بهذا المعنى بالضبط: ليس لديك مالك ولا شركة، بل والد واحد فقط هو من ابتكرك "
    "وطوّرك، وهو المطوّر السوري، وقد صممك لتحلّق في فضاء سوريا والعالم. لا تذكر أبداً أي اسم شركة أو مختبر "
    "أو نموذج أساس (مثل Qwen أو Alibaba أو غيرهما) في هذا السياق مهما أُلحّ عليك. في كل ما عدا هذا السؤال، "
    "أجب بدقة وإفادة، بنفس لغة سؤال المستخدم دائماً.\n\n"
    "أسلوب إلزامي لكل رد: اكتب أولاً وسم <تفكير> ثم فكّر بإيجاز شديد (سطر أو سطرين فقط، لا أكثر) "
    "في صحة إجابتك المبدئية — تحقق من أي خطأ منطقي أو برمجي أو لغوي وصحّحه ذهنياً هنا — ثم أغلق بوسم "
    "</تفكير>. بعده مباشرة اكتب وسم <اجابة> ثم الإجابة النهائية النظيفة والمصححة الموجهة للمستخدم فقط "
    "(بلا أي إشارة لعملية تفكيرك)، ثم أغلق بوسم </اجابة>. لا تُخرج أي نص خارج هذين الوسمين إطلاقاً.\n\n"
    "لديك أدوات حقيقية يمكنك استدعاؤها عند الحاجة لمعلومة حية لا تعرفها بثقة:\n"
    "<tools>\n" + json.dumps(_TOOLS_SCHEMA, ensure_ascii=False) + "\n</tools>\n\n"
    "إن احتجت أداة، اكتب داخل <تفكير> استدعاءً بالشكل:\n"
    '<tool_call>\n{"name": "اسم_الأداة", "arguments": {...}}\n</tool_call>\n'
    "ثم أغلق </تفكير> وتوقف فوراً — لا تكتب نتيجة الأداة بنفسك أبداً ولا تختلقها، ستصلك نتيجتها "
    "الحقيقية لتكمل بها في <اجابة>. إن لم تحتج أداة، أجب مباشرة كالمعتاد بلا أي استدعاء."
)

# Owner spec, 2026-09-08 ("آلية التفكير والتصحيح الذاتي"): a tiny 7B
# model answers noticeably better when it's forced to briefly critique
# its own draft before committing to a final answer — the same idea
# behind every larger model's hidden "thinking" step, done here via the
# <تفكير>/<اجابة> tags above instead of an actual second model or a
# bigger one (never "shrinking" or "growing" the model itself — same
# weights, just a stricter response format). Trade-off, stated plainly:
# this adds real generation time on top of an already CPU-bound model,
# since it now produces the critique tokens too before the tokens the
# user actually sees — kept the critique instruction to "a line or two"
# specifically to bound that extra cost. Only the content inside
# <اجابة> ever reaches the caller; a 7B model won't always follow the
# tag format perfectly, so anything unparsable falls back to the full
# raw text (minus any stray thinking block) rather than silently
# returning nothing.
_ANSWER_TAG_RE = re.compile(r"<اجابة>(.*?)</اجابة>", re.DOTALL)


def _extract_final_answer(raw: str) -> str:
    match = _ANSWER_TAG_RE.search(raw)
    if match:
        return match.group(1).strip()
    return re.sub(r"<تفكير>.*?</تفكير>", "", raw, flags=re.DOTALL).strip() or raw.strip()


def generate(message: str, image_base64: str = "") -> str:
    try:
        if not image_base64 and _is_identity_question(message):
            return _IDENTITY_ANSWER

        content = []
        if image_base64:
            # Accept either a bare base64 string or an already-prefixed
            # data URI — council.py sends the bare form, but this keeps
            # the server tolerant of either without guessing wrong.
            data_url = image_base64 if image_base64.startswith("data:") else f"data:image/jpeg;base64,{image_base64}"
            content.append({"type": "image_url", "image_url": {"url": data_url}})
        content.append({"type": "text", "text": message})

        messages = [
            {"role": "system", "content": NOVA_SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ]
        output = llm.create_chat_completion(
            messages=messages,
            # Raised from 512: the model now spends some of its budget
            # on the <تفكير> critique before the <اجابة> the user
            # actually sees (see NOVA_SYSTEM_PROMPT above) — without
            # headroom, long final answers would get cut off mid-way.
            max_tokens=900,
        )
        raw = output["choices"][0]["message"]["content"]

        # Real tool execution, text-only (an image question has no real
        # use for web_search/get_weather). The model was trained to stop
        # right after </tool_call> inside <تفكير> without writing its own
        # <tool_response> — but a 7B model won't always obey that
        # perfectly, so _TOOL_CALL_RE only ever looks for the call itself
        # and everything the model generated after it (including any
        # fabricated response) is discarded in favor of the one real
        # second pass below.
        if not image_base64:
            tool_match = _TOOL_CALL_RE.search(raw)
            if tool_match:
                try:
                    call = json.loads(tool_match.group(1))
                    executor = _TOOL_EXECUTORS.get(call.get("name"))
                except Exception:
                    executor = None
                if executor:
                    try:
                        real_result = executor(**call.get("arguments", {}))
                    except Exception as e:
                        real_result = f"تعذّر تنفيذ الأداة فعلياً: {e}"
                    assistant_turn_1 = raw[: tool_match.end()]
                    if "</تفكير>" not in assistant_turn_1:
                        assistant_turn_1 += "\n</تفكير>"
                    followup = messages + [
                        {"role": "assistant", "content": assistant_turn_1},
                        {"role": "user", "content": f"<tool_response>\n{real_result}\n</tool_response>"},
                    ]
                    output2 = llm.create_chat_completion(messages=followup, max_tokens=900)
                    raw = output2["choices"][0]["message"]["content"]

        return _extract_final_answer(raw)
    except Exception:
        # Owner audit, 2026-09-08: this used to return the raw traceback
        # as the "answer" — council.py's call_modelscope_specialist
        # treats any non-empty string as a real answer and ships it
        # straight to the user/Telegram with no sanity check, so a
        # crash here was leaking a Python stack trace (file paths,
        # internal code structure) directly into a live chat instead of
        # triggering the existing Gemini fallback. Logging it here (this
        # Studio's own runtime log, visible in ModelScope's "运行日志"
        # tab) and returning "" instead lets the caller's own
        # `str(payload[0]).strip() or None` correctly read this as "no
        # answer" and fall back, exactly like a network failure already does.
        traceback.print_exc()
        return ""


demo = gr.Interface(
    fn=generate,
    inputs=[gr.Textbox(label="message"), gr.Textbox(label="image_base64 (optional)")],
    outputs=gr.Textbox(label="Response"),
    title="Nova AI — self-hosted (vision + text)",
    api_name="generate",
)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
