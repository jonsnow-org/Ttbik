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
import ast
import base64
import glob
import io
import json
import os
import re
import subprocess
import sys
import time
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

# Owner report, 2026-09-09 (real evidence, Studio's own run log):
# "RuntimeError: Cannot send a request, as the client has been closed"
# deep inside huggingface_hub's hf_hub_download, triggered from
# _get_image_pipe() on the first real /صورة request. Root cause found,
# not guessed: huggingface_hub's internal HTTP client is created once
# and reused for the process's lifetime — that's fine for the MAIN
# model above, which downloads eagerly at import time in the main
# thread before Gradio ever starts, but _get_image_pipe/_get_video_pipe
# were deliberately LAZY (only run on the first real request, inside a
# Gradio worker thread) to avoid spending memory on models nobody may
# ever ask for. That lazy-in-a-worker-thread timing is exactly what
# breaks huggingface_hub's shared client here. Fix: split "download the
# files" (cheap, disk-only, no reason to defer) from "load them into a
# pipeline in RAM" (genuinely memory-heavy, worth keeping lazy) —
# download both eagerly here, in the same safe main-thread/startup
# context the main model already uses successfully, and have the lazy
# loaders below read from local disk only (local_files_only=True),
# never touching the network from a worker thread at all.
#
# Owner report, 2026-09-08→09 (real evidence, three redeploys tested):
# even after the retry-with-backoff fix below, image generation stayed
# permanently broken — ruling out a transient cause. Real asymmetry
# found by comparing this to the MAIN model above: the main model
# downloads from ModelScope's OWN hub (modelscope.snapshot_download)
# and has never once failed; these two downloaded from Hugging Face
# (huggingface_hub) and have never once succeeded, despite the owner
# confirming live (screenshot) that the HF repos themselves are public,
# valid, and populated. ModelScope's build infra is confirmed
# China-based (cn-zhangjiakou region, mirrors.aliyun.com PyPI mirror —
# both seen directly in this Studio's own build logs), which is a
# well-known class of real-world network path that frequently cannot
# reach huggingface.co at all regardless of the repo's own validity.
# Fix: stop asking these servers to reach Hugging Face. Mirror both
# models onto ModelScope's own hub instead (see the new upload cells in
# ai-system/colab/generate_image_model.ipynb) and read them with the
# exact same snapshot_download() call already proven reliable for the
# main model above.
_IMAGE_MODEL_ID = "novaai2026/nova-image-gen"
_VIDEO_MODEL_ID = "novaai2026/nova-video-gen"


def _download_with_retries(model_id: str, attempts: int = 3, backoff_seconds: float = 15.0) -> str | None:
    """Owner report, 2026-09-08 (real evidence — the Studio's own run
    log, retrieved directly): a real "RuntimeError: فشل تنزيل نموذج
    الصور..." traced back to _image_model_dir being None, meaning the
    single eager download attempt below had failed once at container
    startup — and with no retry, that ONE failure permanently broke
    image generation for this entire container's lifetime, until the
    next manual redeploy. The log retention window had already rotated
    past the original download error by the time this was noticed, so
    the exact transient cause (network blip, a slow/rate-limited HF
    response during a cold boot, etc.) couldn't be recovered — but a
    single-attempt eager download was always going to be fragile
    against exactly that kind of one-off hiccup regardless of what
    caused it this time. Retries with backoff, still entirely in the
    main thread before Gradio starts — the same safe startup context
    the single-attempt version already used, so this does NOT
    reintroduce the separate, already-fixed "client has been closed"
    bug (that one was specifically about a LAZY download from a Gradio
    worker thread; this stays eager). Uses ModelScope's own
    snapshot_download now (see _IMAGE_MODEL_ID/_VIDEO_MODEL_ID comment
    above) — not huggingface_hub's — since retries alone never fixed
    this in practice, which is exactly what a structural network-path
    problem to huggingface.co (rather than a one-off blip) looks like."""
    for attempt in range(1, attempts + 1):
        try:
            return snapshot_download(model_id)
        except Exception:
            print(f"[startup] download attempt {attempt}/{attempts} for {model_id} failed:")
            traceback.print_exc()
            if attempt < attempts:
                time.sleep(backoff_seconds * attempt)
    print(f"[startup] giving up on {model_id} after {attempts} attempts — generation using this model stays unavailable until the next redeploy.")
    return None


_image_model_dir = _download_with_retries(_IMAGE_MODEL_ID)
_video_model_dir = _download_with_retries(_VIDEO_MODEL_ID)

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
    # owner report, 2026-09-08 (real Telegram evidence): a corrective
    # statement ("لا، أنت لا تملك شركة...") isn't a question and won't
    # contain any "من طورك"-style phrase, but still needs the exact
    # same deterministic answer instead of letting the model "explain
    # itself" back into a wrong company claim.
    "لا انت", "لا أنت", "انت لا تملك", "أنت لا تملك", "ليس لديك مالك",
    "ليس لديك شركة", "ليس لك مالك", "ليس لك شركة",
    "you are chatgpt", "you're chatgpt", "you are gpt",
]

_IDENTITY_ANSWER = (
    "ليس لديّ مالك ولا شركة، بل والد واحد فقط هو من ابتكرني وطوّرني، وهو "
    "المطوّر السوري، وقد صممني لأحلّق في فضاء سوريا والعالم."
)

# Owner report, 2026-09-08 (real Telegram evidence, screenshot): "من
# انت وماهو اسمك" got "أنا نموذج ذكاء اصطناعي تم تطويره بواسطة شركة
# OpenAI. أنا ChatGPT." even though this message contains "من انت"
# and should have matched _IDENTITY_KEYWORDS above — real evidence the
# keyword guard alone isn't a complete guarantee (a stale container
# still finishing a rebuild at that moment is the leading suspect, but
# unconfirmed). Whatever the cause, this is the second, independent
# safety net: any generated answer that both self-identifies AND names
# a forbidden company gets discarded in favor of the real identity
# answer, regardless of why the keyword guard didn't already catch it.
_SELF_REFERENCE_PATTERNS = [
    "أنا نموذج", "أنا ذكاء اصطناعي", "تم تطويري", "طوّرتني", "طورتني",
    "طُوِّر", "developed by", "created by", "i am chatgpt", "i'm chatgpt",
    "i am an ai", "built by", "made by",
]
_FORBIDDEN_IDENTITY_TERMS = ["openai", "chatgpt", "gpt-oss", "alibaba", "qwen", "anthropic"]


def _contains_forbidden_identity_leak(text: str | None) -> bool:
    if not text:
        return False
    normalized = text.lower()
    has_self_reference = any(p in normalized for p in _SELF_REFERENCE_PATTERNS)
    has_forbidden_term = any(t in normalized for t in _FORBIDDEN_IDENTITY_TERMS)
    return has_self_reference and has_forbidden_term


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
    "الحقيقية لتكمل بها في <اجابة>. إن لم تحتج أداة، أجب مباشرة كالمعتاد بلا أي استدعاء.\n\n"
    # Owner spec, 2026-09-08 (Gemini review, "القيود العكسية"/negative
    # constraints): a small model tends to pad answers with empty
    # preambles and to guess rather than admit it doesn't know — both
    # directly reinforce the "never fabricate" principle already
    # applied elsewhere in this project (council.py's own system
    # prompt, the LIVE_INFO web-search fallback), now stated for the
    # model itself instead of only for context injected around it.
    "تنبيهات صارمة: لا تبدأ إجابتك أبداً بمقدمات فارغة مثل 'أهلاً بك، "
    "بصفتي ذكاء اصطناعي...' أو 'بالتأكيد يمكنني مساعدتك في ذلك' — ابدأ "
    "بالإجابة مباشرة. إن كان السؤال يطلب معلومة حقيقية (تاريخاً، رقماً، "
    "اسماً) لست متأكداً منها بثقة تامة، صرّح بوضوح أنك لا تملك هذه "
    "المعلومة الآن، ولا تخترع أو تخمّن أي تفصيل يبدو دقيقاً وهو ليس "
    "كذلك. أي كود برمجي تكتبه يجب أن يكون كاملاً وقابلاً للتشغيل فعلياً "
    "— لا تترك أسطراً ناقصة بتعليقات مثل '# أكمل الباقي هنا'."
)

# Owner spec, 2026-09-08 (Gemini review, "موجه الخبراء الديناميكي"/
# dynamic expert router): a 7B model asked to be equally expert at
# everything, all the time, answers more vaguely than one given a
# narrow, well-defined role for the specific question in front of it.
# query_type is already computed once by main.py's router.classify and
# threaded down here for the temperature choice above — this reuses
# the exact same signal for a second purpose instead of adding a new
# classification pass. GENERAL gets no extra persona: ordinary
# conversation doesn't benefit from being forced into a narrow role.
_EXPERT_PERSONA_BY_QUERY_TYPE = {
    "CODE": (
        "في هذا السؤال تحديداً، تصرّف كمهندس برمجيات محترف ودقيق جداً: "
        "اكتب كوداً نظيفاً وصحيحاً بنيوياً دائماً، مع تعليقات موجزة فقط "
        "عند الحاجة الحقيقية، بلا أي إسهاب."
    ),
    "LIVE_INFO": (
        "في هذا السؤال تحديداً، تصرّف كباحث دقيق يعتمد فقط على "
        "المعلومات المؤكدة المزوَّدة لك في السياق أدناه، ولا يخمّن رقماً "
        "أو تاريخاً أو اسماً أبداً إن لم تصله معلومة حقيقية عنه."
    ),
}

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
# Owner report, 2026-09-09 (real Telegram evidence, screenshot): a reply
# arrived with the literal text "<اجابة>" visible at the top — the model
# opened the tag but never emitted the closing </اجابة> (most likely cut
# off by max_tokens before finishing, though a 7B model can simply drop
# it too). The old fallback below only ever stripped a *complete*
# <تفكير>...</تفكير> block and returned the rest verbatim, so a dangling
# open tag with no match for _ANSWER_TAG_RE fell straight through to the
# user with the raw tag still in it. Real fix: if the strict tag match
# fails, look for a bare opening <اجابة> and take everything after it
# (still real model output, just never closed) before falling back
# further to stripping only <تفكير>.
_ANSWER_OPEN_TAG_RE = re.compile(r"<اجابة>", re.DOTALL)


def _extract_final_answer(raw: str) -> str:
    match = _ANSWER_TAG_RE.search(raw)
    if match:
        return match.group(1).strip()
    open_match = _ANSWER_OPEN_TAG_RE.search(raw)
    if open_match:
        return raw[open_match.end() :].strip()
    return re.sub(r"<تفكير>.*?</تفكير>", "", raw, flags=re.DOTALL).strip() or raw.strip()


# Owner spec, 2026-09-08 (Gemini review, "الفحص البرمجي الذاتي"/AST
# syntax gate): a real, cheap correctness check — ast.parse() either
# confirms the code is syntactically valid Python or names the exact
# line and error, in under a millisecond, no model call needed for the
# check itself. Deliberately scoped to ONLY explicit ```python/```py
# fences (never a bare ``` block, which could be any language) — a
# false "syntax error" on valid JS/Bash/SQL parsed as Python would be
# worse than not checking at all. Only ever triggers a corrective
# second pass on a REAL, confirmed syntax error, so the common case
# (valid code on the first try) pays zero extra latency — important
# given latency is this system's own reported #1 problem right now.
_PYTHON_CODE_BLOCK_RE = re.compile(r"```(?:python|py)\s*\n(.*?)```", re.DOTALL)


def _first_python_syntax_error(text: str) -> str | None:
    """Returns a human-readable "line N: message" string for the first
    explicitly-fenced Python block with a real syntax error, or None if
    there's no such block or it's already valid."""
    match = _PYTHON_CODE_BLOCK_RE.search(text)
    if not match:
        return None
    try:
        ast.parse(match.group(1))
        return None
    except SyntaxError as e:
        return f"line {e.lineno}: {e.msg}"


# Owner spec, 2026-09-08 (Gemini architecture review, "الضبط الديناميكي
# لدرجة الابداع"): a fixed temperature for every query type is a real,
# easy-to-fix weakness on a 7B model — CODE/LIVE_INFO answers need to be
# precise and repeatable (a wrong digit or a "creative" variable name is
# a real bug), while GENERAL conversation benefits from a little more
# natural variety. query_type already exists (router.classify in
# main.py) and is now threaded through from council.py to here, so this
# reuses a signal we already compute instead of adding a new one.
_TEMPERATURE_BY_QUERY_TYPE = {"CODE": 0.1, "LIVE_INFO": 0.2, "GENERAL": 0.6}


def _temperature_for(query_type: str) -> float:
    return _TEMPERATURE_BY_QUERY_TYPE.get(query_type, 0.6)


# Owner spec, 2026-09-08 (Gemini architecture review, "تحديد سقف
# التوكنز"): CPU token generation time scales with tokens actually
# produced, so capping GENERAL/LIVE_INFO chat replies well below the old
# flat 900 is a real, direct latency win for the common case (an
# ordinary Telegram reply has no business running that long). Kept
# query-type-aware rather than one flat number for every reply, though
# — a flat low cap would also apply to CODE answers, where the AST
# syntax gate below can trigger a full second generation pass on a
# truncated (and therefore often syntactically invalid) code block,
# which would make total latency WORSE than the original 900, not
# better. So CODE keeps real headroom; only GENERAL/LIVE_INFO (which
# reuses the same tighter budget in most other cases here) get cut down
# near the 300-400 Gemini proposed.
# GENERAL raised from an initial 400 to 500 after real evidence
# (2026-09-09): a reply arrived with a literal unclosed "<اجابة>" tag
# visible to the user — the mandatory <تفكير> preamble on a wordier
# attempt can eat into a tight budget, leaving too little room to close
# <اجابة> before hitting the cap. 500 still cuts the old flat 900
# nearly in half (the real latency win) while giving real headroom for
# the preamble; the fallback in _extract_final_answer above is now also
# hardened to never leak a bare open tag regardless of budget.
_MAX_TOKENS_BY_QUERY_TYPE = {"CODE": 900, "LIVE_INFO": 500, "GENERAL": 500}


def _max_tokens_for(query_type: str) -> int:
    return _MAX_TOKENS_BY_QUERY_TYPE.get(query_type, 400)


def generate(message: str, image_base64: str = "", query_type: str = "GENERAL") -> str:
    try:
        if not image_base64 and _is_identity_question(message):
            return _IDENTITY_ANSWER

        temperature = _temperature_for(query_type)
        persona = _EXPERT_PERSONA_BY_QUERY_TYPE.get(query_type, "")
        system_content = f"{NOVA_SYSTEM_PROMPT}\n\n{persona}" if persona else NOVA_SYSTEM_PROMPT
        # A detailed image description ("صف هذه الصورة بالتفصيل") needs
        # real headroom regardless of query_type (main.py's /image
        # handler never even sets one, so this would otherwise silently
        # inherit GENERAL's tight 400-token cap below and cut off
        # mid-description) — vision was never what Gemini's max_tokens
        # suggestion was about (Telegram TEXT replies specifically).
        max_tokens = 900 if image_base64 else _max_tokens_for(query_type)

        content = []
        if image_base64:
            # Accept either a bare base64 string or an already-prefixed
            # data URI — council.py sends the bare form, but this keeps
            # the server tolerant of either without guessing wrong.
            data_url = image_base64 if image_base64.startswith("data:") else f"data:image/jpeg;base64,{image_base64}"
            content.append({"type": "image_url", "image_url": {"url": data_url}})
        content.append({"type": "text", "text": message})

        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": content},
        ]
        output = llm.create_chat_completion(
            messages=messages,
            # Query-type-aware (see _MAX_TOKENS_BY_QUERY_TYPE above) —
            # still has to cover the <تفكير> critique before the
            # <اجابة> the user actually sees (see NOVA_SYSTEM_PROMPT),
            # which is why CODE/vision keep the old, more generous 900
            # rather than all being cut to GENERAL's tighter budget.
            max_tokens=max_tokens,
            temperature=temperature,
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
                    output2 = llm.create_chat_completion(messages=followup, max_tokens=max_tokens, temperature=temperature)
                    raw = output2["choices"][0]["message"]["content"]

        # AST syntax gate (see _first_python_syntax_error above) — one
        # real corrective pass, only when there's a confirmed syntax
        # error, never a guess.
        syntax_error = _first_python_syntax_error(raw)
        if syntax_error:
            correction = messages + [
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": (
                        f"يوجد خطأ برمجي حقيقي في الكود أعلاه (تحقق فعلي عبر ast.parse، وليس تخميناً): "
                        f"{syntax_error}. أعد كتابة <تفكير> و<اجابة> الكاملتين بعد تصحيح هذا الخطأ فقط، بنفس الشكل بالضبط."
                    ),
                },
            ]
            try:
                # Deliberately NOT the query-type-aware max_tokens above:
                # this path only ever fires when a real Python code block
                # was found (see _first_python_syntax_error), so the
                # rewritten answer needs the same full code-sized budget
                # regardless of query_type — truncating the correction
                # itself would be worse than the one-time extra latency.
                output3 = llm.create_chat_completion(messages=correction, max_tokens=900, temperature=temperature)
                corrected_raw = output3["choices"][0]["message"]["content"]
                if _first_python_syntax_error(corrected_raw) is None:
                    raw = corrected_raw
                # else: still broken after one real retry — ship the
                # original rather than looping indefinitely; a syntax
                # error visible to the user beats never answering.
            except Exception:
                pass

        final_answer = _extract_final_answer(raw)
        if _contains_forbidden_identity_leak(final_answer):
            return _IDENTITY_ANSWER
        return final_answer
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


# Owner spec, 2026-09-09 ("لا تجعل كل الامور مترابطة ومتشابكة ومعقدة"):
# real evidence (Render logs, same day) that Hugging Face's free
# hf-inference provider refuses to serve our own image-generation repo
# too — "Model not supported by provider hf-inference", the exact same
# wall already hit and fixed for text/vision. Consolidating onto this
# one box instead of juggling two platforms: Hugging Face is now only
# used to archive trained weights (ownership/backup), never to serve a
# live request — ModelScope hosts everything real (text, vision, and
# now images) in one place, one deployment pipeline, one thing to
# reason about.
_image_pipe = None


def _get_image_pipe():
    """Loaded lazily, only on the first real image request — this box
    already holds a 7B GGUF language model in memory at all times;
    loading Stable Diffusion's own weights on every cold start whether
    or not anyone ever asks for an image would risk pushing combined
    memory past this free box's real limit for no benefit on the
    common case (an ordinary text/vision question). local_files_only:
    the actual download already happened eagerly at module import time
    above (see the real "client has been closed" evidence there for
    why) — this must never touch the network itself."""
    global _image_pipe
    if _image_pipe is None:
        if _image_model_dir is None:
            raise RuntimeError("فشل تنزيل نموذج الصور عند بدء تشغيل الاستوديو — راجع سجل التشغيل.")
        import torch
        from diffusers import AutoPipelineForText2Image

        _image_pipe = AutoPipelineForText2Image.from_pretrained(_image_model_dir, torch_dtype=torch.float32, local_files_only=True)
    return _image_pipe


def generate_image(prompt: str) -> str:
    """Returns a base64-encoded PNG string directly (not a file path) —
    council.py's caller decodes this the same way it already decodes
    text responses, no new wire format introduced. Real CPU-only
    Stable Diffusion inference on a 2-vCPU box is genuinely slow (this
    is why council.py's generate_image call and main.py's
    /generate-image endpoint are both async now, delivering straight to
    Telegram once ready — see main.py's module comment on that
    endpoint) — 25 steps is a deliberate floor for real image quality,
    not an arbitrary number to guess-tune later."""
    try:
        pipe = _get_image_pipe()
        image = pipe(prompt, num_inference_steps=25).images[0]
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        traceback.print_exc()
        return ""


# Owner spec, 2026-09-09 ("قم ايضا بارسال الفديو الى ModelScope"):
# explicit owner instruction to also host video here, after being told
# plainly this box has no GPU and CogVideoX-2B (a real 2B-parameter
# video diffusion model, already trained and confirmed working on
# Kaggle's GPU) could plausibly take HOURS per video on CPU alone, and
# risks pushing this box's combined memory (this LLM + the image model
# above + this) past its real 16GB limit, possibly destabilizing text/
# vision too. Owner chose to proceed anyway — implemented honestly,
# not held back further; the real timing and stability, good or bad,
# will only be known once this is actually tried live.
_video_pipe = None


def _get_video_pipe():
    """Loaded lazily, only on the first real video request — same
    reasoning as _get_image_pipe above, doubly important here since
    this model is far heavier. local_files_only: same real "client has
    been closed" fix as the image pipe — the download already happened
    eagerly at module import time. enable_model_cpu_offload() (used in
    the Kaggle training notebook) is deliberately NOT called here — it
    shuttles weights between a GPU and CPU, which requires a GPU to
    shuttle to/from in the first place; this box has none, so the
    model simply stays resident in CPU RAM as-is. VAE slicing/tiling
    ARE kept since those reduce peak memory during decode regardless of
    which device is doing the compute."""
    global _video_pipe
    if _video_pipe is None:
        if _video_model_dir is None:
            raise RuntimeError("فشل تنزيل نموذج الفيديو عند بدء تشغيل الاستوديو — راجع سجل التشغيل.")
        import torch
        from diffusers import CogVideoXPipeline

        _video_pipe = CogVideoXPipeline.from_pretrained(_video_model_dir, torch_dtype=torch.float32, local_files_only=True)
        _video_pipe.vae.enable_slicing()
        _video_pipe.vae.enable_tiling()
    return _video_pipe


_VIDEO_FPS = 8  # must match council.py's _seconds_to_cogvideox_frames assumption


def generate_video(prompt: str, num_frames: float = 49) -> str:
    """Returns a base64-encoded MP4 string directly, same shape as
    generate_image's base64 PNG above. num_frames comes from
    council.py's _seconds_to_cogvideox_frames — already rounded there
    to a valid 4n+1 count for CogVideoX's temporal VAE, so this just
    casts the raw float Gradio hands every Number input back to int.
    Real cost, stated plainly rather than tuned around: CPU-only
    inference for a model this size is unmeasured territory — the one
    confirmed-working test (49 frames, ~17 minutes on a real T4 GPU —
    see ai-system/colab/generate_image_model.ipynb) could plausibly
    take hours here, and a longer request costs proportionally more,
    not a fixed amount. num_inference_steps is kept at the same value
    already confirmed to produce a real working video on GPU, not
    lowered to guess-optimize for CPU speed at the cost of guessing the
    output still looks right."""
    try:
        from diffusers.utils import export_to_video

        pipe = _get_video_pipe()
        frames = pipe(
            prompt=prompt, num_videos_per_prompt=1, num_inference_steps=50, num_frames=int(num_frames), guidance_scale=6
        ).frames[0]
        path = "/tmp/nova_generated_video.mp4"
        export_to_video(frames, path, fps=_VIDEO_FPS)
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("ascii")
    except Exception:
        traceback.print_exc()
        return ""


_text_interface = gr.Interface(
    fn=generate,
    inputs=[
        gr.Textbox(label="message"),
        gr.Textbox(label="image_base64 (optional)"),
        gr.Textbox(label="query_type (optional, CODE|LIVE_INFO|GENERAL)"),
    ],
    outputs=gr.Textbox(label="Response"),
    title="نص ورؤية",
    api_name="generate",
)

_image_interface = gr.Interface(
    fn=generate_image,
    inputs=gr.Textbox(label="prompt"),
    outputs=gr.Textbox(label="image_base64"),
    title="توليد صور",
    api_name="generate_image",
)

_video_interface = gr.Interface(
    fn=generate_video,
    inputs=[
        gr.Textbox(label="prompt"),
        gr.Number(label="num_frames", value=49),
    ],
    outputs=gr.Textbox(label="video_base64"),
    title="توليد فيديو",
    api_name="generate_video",
)

demo = gr.TabbedInterface(
    [_text_interface, _image_interface, _video_interface],
    ["نص ورؤية", "توليد صور", "توليد فيديو"],
    title="Nova AI — self-hosted (نص + رؤية + صور + فيديو)",
)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
