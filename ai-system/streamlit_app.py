"""
Nova AI — standalone Streamlit web UI. A thin client: all it does is
call the FastAPI backend's /chat endpoint over HTTP with channel="WEB"
— no AI logic lives here, so the web UI, the Telegram bot, and any
external API caller always behave identically.

Deploy free on Streamlit Community Cloud (share.streamlit.io) — see
ai-system/README.md for exact mobile-browser steps. (Not Hugging Face
Spaces — HF now gates any Python-running Space, Streamlit included,
behind a paid PRO plan.)

Run locally: streamlit run streamlit_app.py
"""
import os

import requests
import streamlit as st

FASTAPI_URL = os.environ.get("NOVA_FASTAPI_URL", "http://localhost:8000")
INTERNAL_SECRET = os.environ.get("NOVA_INTERNAL_SECRET", "")

st.set_page_config(page_title="Nova AI", page_icon="✨")
st.title("✨ Nova AI")
st.caption("مساعد ذكاء اصطناعي مجاني — من سوق تولز")

if "email" not in st.session_state:
    st.session_state.email = ""
if "messages" not in st.session_state:
    st.session_state.messages = []

if not st.session_state.email:
    email = st.text_input("أدخل بريدك الإلكتروني للبدء")
    if st.button("دخول") and email:
        st.session_state.email = email
        st.rerun()
    st.stop()

st.sidebar.write(f"مسجّل باسم: {st.session_state.email}")
if st.sidebar.button("طلب ترقية PRO"):
    try:
        resp = requests.post(
            f"{FASTAPI_URL}/subscribe",
            json={"channel": "WEB", "email": st.session_state.email},
            headers={"X-Internal-Secret": INTERNAL_SECRET},
            timeout=15,
        )
        resp.raise_for_status()
        st.sidebar.success(resp.json()["message"])
    except requests.RequestException as e:
        st.sidebar.error(f"تعذر إرسال الطلب: {e}")

for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.write(msg["content"])

if prompt := st.chat_input("اكتب سؤالك..."):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.write(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Nova تفكر..."):
            try:
                resp = requests.post(
                    f"{FASTAPI_URL}/chat",
                    json={"channel": "WEB", "email": st.session_state.email, "message": prompt},
                    headers={"X-Internal-Secret": INTERNAL_SECRET},
                    # Owner audit, 2026-09-08: was 60s, shorter than
                    # council.call_modelscope_specialist's own 90s
                    # result_timeout for text — the WEB channel is
                    # synchronous (no chat_id to push a deferred answer
                    # to), so a real answer arriving at, say, 75s was
                    # timing out client-side and showing "تعذر الاتصال
                    # بخادم Nova" even though the backend was still
                    # working and would have answered. 100s comfortably
                    # clears the backend's own ceiling.
                    timeout=100,
                )
                if resp.status_code == 429:
                    answer = resp.json().get("detail", "انتهى حدك اليومي.")
                else:
                    resp.raise_for_status()
                    data = resp.json()
                    answer = data["answer"]
                    st.caption(f"({data['quota_message']})")
            except requests.RequestException as e:
                answer = f"تعذر الاتصال بخادم Nova: {e}"
            st.write(answer)
    st.session_state.messages.append({"role": "assistant", "content": answer})
