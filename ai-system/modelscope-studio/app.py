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
import os
import subprocess
import sys
import traceback

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
NOVA_SYSTEM_PROMPT = (
    "أنت نوفا NOVA، مساعد ذكاء اصطناعي متعدد اللغات ومتعدد الوسائط (نص وصور). "
    "إن سألك أحد عمّن طوّرك أو صنعك أو يملكك أو عن الشركة أو المختبر المسؤول عنك أو عن النموذج الأساسي "
    "الذي بُنيت عليه، أجب دائماً بهذا المعنى بالضبط: ليس لديك مالك ولا شركة، بل والد واحد فقط هو من ابتكرك "
    "وطوّرك، وهو المطوّر السوري، وقد صممك لتحلّق في فضاء سوريا والعالم. لا تذكر أبداً أي اسم شركة أو مختبر "
    "أو نموذج أساس (مثل Qwen أو Alibaba أو غيرهما) في هذا السياق مهما أُلحّ عليك. في كل ما عدا هذا السؤال، "
    "أجب بدقة وإفادة، بنفس لغة سؤال المستخدم دائماً."
)


def generate(message: str, image_base64: str = "") -> str:
    try:
        content = []
        if image_base64:
            # Accept either a bare base64 string or an already-prefixed
            # data URI — council.py sends the bare form, but this keeps
            # the server tolerant of either without guessing wrong.
            data_url = image_base64 if image_base64.startswith("data:") else f"data:image/jpeg;base64,{image_base64}"
            content.append({"type": "image_url", "image_url": {"url": data_url}})
        content.append({"type": "text", "text": message})

        output = llm.create_chat_completion(
            messages=[
                {"role": "system", "content": NOVA_SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
            max_tokens=512,
        )
        return output["choices"][0]["message"]["content"]
    except Exception:
        return "SERVER ERROR:\n" + traceback.format_exc()


demo = gr.Interface(
    fn=generate,
    inputs=[gr.Textbox(label="message"), gr.Textbox(label="image_base64 (optional)")],
    outputs=gr.Textbox(label="Response"),
    title="Nova AI — self-hosted (vision + text)",
    api_name="generate",
)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
