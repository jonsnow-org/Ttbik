"""
Sham — standalone Streamlit web UI, mirroring the exact same
"thin client, all real work happens in the backend" pattern as the
live production ai-system/streamlit_app.py: this file contains NO
model logic at all, only HTTP calls to serve.py's real backend — so a
Telegram bot added later needs zero changes to serve.py, just another
thin client like this one hitting the same endpoints.

Honest, upfront (matches serve.py's own docstring): no real
large-scale training has happened yet, so every generated result here
will look like structured noise — a real image/audio/video file, just
not a meaningful one — until the actual training stage runs. This UI
exists to let a real person click through and confirm the whole
pipeline (prompt -> real model -> real file -> shown on screen) works,
not to judge output quality yet.

Run locally (after starting serve.py separately):
    uvicorn serve:app --port 8000 &
    streamlit run web_app.py
"""

import os

import requests
import streamlit as st

BACKEND_URL = os.environ.get("SHAM_SMALL_BACKEND_URL", "http://localhost:8000")

st.set_page_config(page_title="Sham (تجريبي)", page_icon="🧪")
st.title("🧪 Sham — اختبار مباشر")
st.caption(
    "نموذج من الصفر، ملكية كاملة — هذه نسخة اختبار قبل التدريب الفعلي الكبير: "
    "تختبر أن كل شيء متصل ويعمل تقنياً، وليس جودة الناتج بعد."
)

mode = st.sidebar.radio("نوع التوليد", ["نص", "صورة", "صوت", "فيديو"])
st.sidebar.caption(f"الخادم: {BACKEND_URL}")

if st.sidebar.button("فحص حالة الخادم"):
    try:
        health = requests.get(f"{BACKEND_URL}/health", timeout=10).json()
        st.sidebar.success(f"الخادم يعمل — {health['model_params']:,} معامل")
        st.sidebar.caption(health["note"])
    except requests.RequestException as e:
        st.sidebar.error(f"تعذر الوصول للخادم: {e}")


def _call_backend(endpoint: str, payload: dict, timeout: float):
    resp = requests.post(f"{BACKEND_URL}/generate/{endpoint}", json=payload, timeout=timeout)
    resp.raise_for_status()
    return resp


if mode == "نص":
    prompt = st.text_input("اكتب بداية النص")
    max_new_tokens = st.slider("عدد الرموز المولَّدة", 10, 200, 40)
    if st.button("توليد نص") and prompt:
        with st.spinner("يفكر..."):
            try:
                data = _call_backend("text", {"prompt": prompt, "max_new_tokens": max_new_tokens}, timeout=60).json()
                st.write(data["text"] or "(نص فارغ — طبيعي مع نموذج غير مُدرَّب بعد)")
            except requests.RequestException as e:
                st.error(f"تعذر الاتصال بالخادم: {e}")

elif mode == "صورة":
    prompt = st.text_input("صف الصورة المطلوبة")
    if st.button("توليد صورة") and prompt:
        with st.spinner("يرسم..."):
            try:
                resp = _call_backend("image", {"prompt": prompt}, timeout=120)
                st.image(resp.content, caption="ناتج حقيقي من النموذج (عشوائي قبل التدريب الفعلي)")
            except requests.RequestException as e:
                st.error(f"تعذر الاتصال بالخادم: {e}")

elif mode == "صوت":
    prompt = st.text_input("اكتب نصاً ليُحوَّل إلى صوت")
    if st.button("توليد صوت") and prompt:
        with st.spinner("يستمع..."):
            try:
                resp = _call_backend("audio", {"prompt": prompt}, timeout=120)
                st.audio(resp.content, format="audio/wav")
            except requests.RequestException as e:
                st.error(f"تعذر الاتصال بالخادم: {e}")

elif mode == "فيديو":
    prompt = st.text_input("صف الفيديو المطلوب")
    num_frames = st.slider("عدد الإطارات", 1, 6, 2)
    if st.button("توليد فيديو") and prompt:
        with st.spinner("يصوّر... (قد يأخذ وقتاً أطول)"):
            try:
                resp = _call_backend("video", {"prompt": prompt, "num_frames": num_frames}, timeout=180)
                st.video(resp.content)
            except requests.RequestException as e:
                st.error(f"تعذر الاتصال بالخادم: {e}")
