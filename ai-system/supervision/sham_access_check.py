"""
What can Sham's automation actually reach and write to? (answer measured, not assumed)

Runs on the GitHub runner, where the repository secrets live. For every service it checks that the secret EXISTS and that the
service ACCEPTS it with one harmless read request. It prints a verdict per service — never a token, a user name or a URL.
A deploy hook is only checked for presence (calling it would deploy). Exit code is always 0: it is a report, not a gate.
"""

from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request


def _get(url: str, headers: dict | None = None, timeout: int = 20) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return 0, b""


def _verdict(code: int) -> str:
    return "✅ يقبل المفتاح" if code == 200 else "❌ رفض المفتاح" if code in (401, 403) else f"⚠ لا جواب واضح ({code})"


def check_all(env=os.environ) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    have = lambda k: bool((env.get(k) or "").strip())

    if have("GITHUB_TOKEN"):
        code, body = _get(f"https://api.github.com/repos/{env.get('GITHUB_REPOSITORY', '')}",
                          {"Authorization": f"Bearer {env['GITHUB_TOKEN']}"})
        perm = ""
        if code == 200:
            try:
                perm = " | كتابة: " + ("نعم" if json.loads(body).get("permissions", {}).get("push") else "لا")
            except Exception:
                pass
        out.append(("GitHub", _verdict(code) + perm))

    if have("KAGGLE_API_TOKEN"):
        try:
            r = subprocess.run(["kaggle", "datasets", "status", f"{env.get('KAGGLE_USERNAME', '')}/sham-reports"], capture_output=True, text=True,
                               timeout=90)
            out.append(("Kaggle", "✅ يقبل المفتاح" if r.returncode == 0 else "❌ لم ينجح الطلب"))
        except Exception:
            out.append(("Kaggle", "⚠ تعذّر الفحص"))
    else:
        out.append(("Kaggle", "— لا مفتاح"))

    if have("HF_TOKEN"):
        code, body = _get("https://huggingface.co/api/whoami-v2", {"Authorization": f"Bearer {env['HF_TOKEN']}"})
        role = ""
        if code == 200:
            try:
                role = " | الصلاحية: " + str(json.loads(body).get("auth", {}).get("accessToken", {}).get("role", "غير معروفة"))
            except Exception:
                pass
        out.append(("Hugging Face", _verdict(code) + role))
    else:
        out.append(("Hugging Face", "— لا مفتاح"))

    if have("MODELSCOPE_TOKEN"):
        try:       # the SDK's login only exchanges the token for a session: nothing in the account changes
            from modelscope.hub.api import HubApi
            HubApi().login(env["MODELSCOPE_TOKEN"])
            out.append(("ModelScope", "✅ يقبل المفتاح"))
        except ImportError:
            out.append(("ModelScope", "مفتاح موجود (مكتبة الفحص غير مثبتة)"))
        except Exception as exc:
            out.append(("ModelScope", f"❌ لم ينجح الدخول ({type(exc).__name__})"))
    else:
        out.append(("ModelScope", "— لا مفتاح"))

    if have("TELEGRAM_BOT_TOKEN"):
        out.append(("Telegram", _verdict(_get(f"https://api.telegram.org/bot{env['TELEGRAM_BOT_TOKEN']}/getMe")[0])))
    else:
        out.append(("Telegram", "— لا مفتاح"))

    if have("GROQ_API_KEY"):
        out.append(("Groq", _verdict(_get("https://api.groq.com/openai/v1/models",
                                          {"Authorization": f"Bearer {env['GROQ_API_KEY']}", "User-Agent": "sham-access-check"})[0])))
    else:
        out.append(("Groq", "— لا مفتاح"))

    if have("SUPABASE_URL") and have("SUPABASE_SERVICE_ROLE_KEY"):
        out.append(("Supabase", _verdict(_get(env["SUPABASE_URL"].rstrip("/") + "/rest/v1/",
                                              {"apikey": env["SUPABASE_SERVICE_ROLE_KEY"]})[0])))
    else:
        out.append(("Supabase", "— لا مفتاح"))

    out.append(("Modal", "مفتاحان موجودان (المعرّف والسر)" if have("MODAL_TOKEN_ID") and have("MODAL_TOKEN_SECRET")
                else "— ناقص (المعرّف أو السر غير مضاف)"))
    if have("MODELSCOPE_TOKEN"):          # the hosted Sham itself: the same call the Telegram bot makes (phase/step only are printed)
        try:
            import sys
            from pathlib import Path
            sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "colab" / "sham_small" / "web"))
            import studio_client
            os.environ["MODELSCOPE_API_TOKEN"] = env["MODELSCOPE_TOKEN"]
            st = studio_client.studio_status()
            out.append(("شام على استوديو ModelScope", f"✅ يردّ: {st.get('phase')} — الخطوة {st.get('detail', '')}" if st else "❌ لا جواب (الرابط أو المفتاح)"))
            if st:      # a real generation: what the owner would see in Telegram (the model's own text, no secret in it)
                sample = studio_client.generate_text("اللغة العربية هي", 30, timeout=120)
                out.append(("عيّنة من شام على الاستوديو", repr((sample or "—")[:140])))
        except Exception as exc:
            out.append(("شام على استوديو ModelScope", f"⚠ تعذّر الفحص ({type(exc).__name__})"))
    out.append(("Render (خطّاف نشر)", "موجود" if have("RENDER_NOVA_SMALL_DEPLOY_HOOK") else "— غير موجود"))
    return out


if __name__ == "__main__":
    empty = check_all({})
    assert len(empty) >= 6 and all(isinstance(a, str) and isinstance(b, str) for a, b in empty)
    assert not any("secretvalue" in b for _, b in check_all({"MODELSCOPE_TOKEN": "secretvalue", "RENDER_NOVA_SMALL_DEPLOY_HOOK": "secretvalue"}))
    if os.environ.get("SHAM_ACCESS_LIVE"):
        for name, verdict in check_all():
            print(f"{name}: {verdict}")
    else:
        print("sham_access_check self-test OK")
