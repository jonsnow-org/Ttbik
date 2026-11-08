"""
Telegram side of Muse Spark Open.

You write to the bot, it opens a GitHub issue, Muse Spark Open answers on the issue, and the answer comes back here.

  /build <what to build>      -> issue "Telegram: [...]", NORMAL mode (Muse answers with a comment: plan / code, changes nothing)
  /fix <what to fix>          -> same, NORMAL mode
  /full <what to do>          -> adds the label `muse-full`: Muse may create a branch, commit, and open a pull request (never writes to main)
  any other text              -> NORMAL mode
  /help                       -> this list

Only messages from TELEGRAM_CHAT_ID (the owner's chat) are accepted; everything else is ignored.

Three ways to run it:
  python telegram_bot.py poll --seconds 270   one listening session (what .github/workflows/telegram-bridge.yml runs every 5 minutes)
  python telegram_bot.py relay                send Muse's last comment of the issue named in RUN_TITLE ("Muse #12") back to Telegram (the same workflow)
  python telegram_bot.py                      a permanent bot (python-telegram-bot) on any machine that stays on; needs the same environment variables

Environment: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GITHUB_TOKEN (or GH_TOKEN), GITHUB_REPOSITORY (owner/name). Nothing here prints a secret.
"""
from __future__ import annotations

import os
import re
import sys
import time

import requests

API = "https://api.github.com"
TG = "https://api.telegram.org"
MARK = "<!-- muse-reply -->"
FULL_LABEL = "muse-full"
HELP = ("أوامر Muse Spark Open:\n/build <ما تريد بناءه>\n/fix <ما تريد إصلاحه>\n/full <مهمة بصلاحيات كاملة: فرع + commit + طلب دمج>\n"
        "أي نص آخر يُعامل كطلب عادي (تعليق وتحليل فقط).")


# ------------------------------------------------------------------ pure helpers (tested)

def parse_command(text: str) -> tuple[str, str]:
    """('build'|'fix'|'full'|'help'|'plain', the request text)."""
    t = (text or "").strip()
    m = re.match(r"^/(build|fix|full|help|start)(?:@\w+)?(?:\s+(.*))?$", t, re.S | re.I)
    if not m:
        return "plain", t
    cmd = m.group(1).lower()
    return ("help" if cmd == "start" else cmd), (m.group(2) or "").strip()


def issue_fields(cmd: str, body: str, chat_id: int | str, update_id: int | str) -> dict | None:
    """The GitHub issue for a Telegram message, or None when there is nothing to ask. Title format: "Telegram: [text]"."""
    if cmd == "help" or not body.strip():
        return None
    line = " ".join(body.split())
    title = f"Telegram: [{line[:90]}{'…' if len(line) > 90 else ''}]"
    labels = ["from-telegram"] + ([FULL_LABEL] if cmd == "full" else []) + ([cmd] if cmd in ("build", "fix") else [])
    text = f"/{cmd} {body}" if cmd != "plain" else body
    return {"title": title, "labels": labels, "body": f"{text}\n\n<!-- tg-chat:{chat_id} -->\n<!-- tg-update:{update_id} -->"}


def chat_of(issue_body: str) -> str | None:
    m = re.search(r"<!-- tg-chat:(-?\d+) -->", issue_body or "")
    return m.group(1) if m else None


def split_message(text: str, limit: int = 3900) -> list[str]:
    out, cur = [], ""
    for para in text.split("\n"):
        while len(para) > limit:
            if cur:
                out.append(cur)
                cur = ""
            out.append(para[:limit])
            para = para[limit:]
        if len(cur) + len(para) + 1 > limit:
            out.append(cur)
            cur = para
        else:
            cur = f"{cur}\n{para}" if cur else para
    if cur:
        out.append(cur)
    return out or [""]


def clean_reply(comment_body: str) -> str:
    return re.sub(r"<sub>.*?</sub>", "", comment_body.replace(MARK, ""), flags=re.S).strip()


# ------------------------------------------------------------------ network

def _env(name: str) -> str:
    v = os.environ.get(name) or (os.environ.get("GH_TOKEN") if name == "GITHUB_TOKEN" else "")
    if not v:
        raise SystemExit(f"missing environment variable {name}")
    return v


def gh(method: str, path: str, **kw):
    r = requests.request(method, f"{API}{path}", headers={"Authorization": f"Bearer {_env('GITHUB_TOKEN')}", "Accept": "application/vnd.github+json"}, timeout=60, **kw)
    if r.status_code >= 300:
        raise RuntimeError(f"GitHub {method} {path} -> {r.status_code}: {r.text[:160]}")
    return r.json() if r.text else {}


def tg(method: str, **data):
    r = requests.post(f"{TG}/bot{_env('TELEGRAM_BOT_TOKEN')}/{method}", json=data, timeout=data.get("timeout", 30) + 15)
    j = r.json()
    if not j.get("ok"):
        raise RuntimeError(f"Telegram {method}: {j.get('description')}")
    return j["result"]


def send(chat_id: str | int, text: str) -> None:
    for part in split_message(text):
        tg("sendMessage", chat_id=chat_id, text=part or "…", disable_web_page_preview=True)


def already_opened(update_id: int | str) -> bool:
    r = gh("GET", "/search/issues", params={"q": f'repo:{_env("GITHUB_REPOSITORY")} in:body "tg-update:{update_id} " is:issue'})
    return any(f"tg-update:{update_id} -->" in (i.get("body") or "") for i in r.get("items", []))


def handle_text(text: str, chat_id: int | str, update_id: int | str) -> str:
    """One Telegram message -> an issue (or the help text). Returns what to say back at once."""
    if str(chat_id) != str(_env("TELEGRAM_CHAT_ID")):
        return ""                                               # not the owner: ignored, no answer
    cmd, body = parse_command(text)
    fields = issue_fields(cmd, body, chat_id, update_id)
    if fields is None:
        return HELP
    if already_opened(update_id):
        return ""
    issue = gh("POST", f"/repos/{_env('GITHUB_REPOSITORY')}/issues", json=fields)
    mode = "صلاحيات كاملة (فرع + طلب دمج)" if FULL_LABEL in fields["labels"] else "عادي (تعليق وتحليل)"
    return f"استلمتُ طلبك — القضية #{issue['number']}، الوضع: {mode}. سيصلك الرد هنا."


# ------------------------------------------------------------------ modes

def run_poll(seconds: int) -> int:
    offset, end = None, time.time() + seconds
    while time.time() < end:
        wait = int(max(1, min(50, end - time.time())))
        try:
            updates = tg("getUpdates", offset=offset, timeout=wait, allowed_updates=["message"])
        except Exception as exc:
            print("telegram getUpdates failed:", str(exc)[:120])
            time.sleep(5)
            continue
        for u in updates:
            offset = u["update_id"] + 1
            m = u.get("message") or {}
            if not m.get("text"):
                continue
            try:
                reply = handle_text(m["text"], m["chat"]["id"], u["update_id"])
                if reply:
                    send(m["chat"]["id"], reply)
            except Exception as exc:
                print("could not handle an update:", str(exc)[:160])
        if offset is not None and not updates:
            continue
    if offset is not None:
        tg("getUpdates", offset=offset, timeout=0)                 # confirm what was taken so the next run does not see it again
    return 0


def run_relay() -> int:
    m = re.search(r"Muse #(\d+)", os.environ.get("RUN_TITLE", ""))
    if not m:
        print("no issue number in RUN_TITLE: nothing to relay")
        return 0
    n = m.group(1)
    repo = _env("GITHUB_REPOSITORY")
    issue = gh("GET", f"/repos/{repo}/issues/{n}")
    chat = chat_of(issue.get("body") or "")
    if not chat or str(chat) != str(_env("TELEGRAM_CHAT_ID")):
        print("issue did not come from the owner's Telegram chat: nothing to relay")
        return 0
    comments = [c for c in gh("GET", f"/repos/{repo}/issues/{n}/comments?per_page=100") if MARK in c["body"]]
    if not comments:
        return 0
    last = comments[-1]
    reacts = gh("GET", f"/repos/{repo}/issues/comments/{last['id']}/reactions")
    if any(r.get("content") == "rocket" for r in reacts):
        print("already sent")
        return 0
    send(chat, f"✅ Muse Spark Open — القضية #{n}\n\n{clean_reply(last['body'])}")
    gh("POST", f"/repos/{repo}/issues/comments/{last['id']}/reactions", json={"content": "rocket"})   # marks it as sent
    return 0


def run_permanent() -> int:
    from telegram import Update
    from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

    async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not update.message or not update.message.text:
            return
        reply = handle_text(update.message.text, update.message.chat_id, update.update_id)
        if reply:
            await update.message.reply_text(reply)

    app = Application.builder().token(_env("TELEGRAM_BOT_TOKEN")).build()
    app.add_handler(CommandHandler(["start", "help", "build", "fix", "full"], on_message))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    app.run_polling()
    return 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "poll":
        sys.exit(run_poll(int(sys.argv[sys.argv.index("--seconds") + 1]) if "--seconds" in sys.argv else 270))
    sys.exit(run_relay() if mode == "relay" else run_permanent())
