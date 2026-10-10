"""Sham — /ask/web FastAPI route (wired from serve.py): answer from a live web search and, automatically, keep the turn as a
learning experience (self_learn.py). The served weights are never changed by a request."""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

from model import ShamSmall
from text_tokenizer import ShamTextTokenizer


class WebAskRequest(BaseModel):
    """Live web search + grounded answer. `learn` (default true) keeps the turn as an experience for the guarded learning
    round; it has no effect when SHAM_SELF_LEARN=0."""
    question: str
    max_new_tokens: int = 60
    learn: bool = True


def register_ask_web(app: FastAPI, state: dict) -> None:
    @app.post("/ask/web")
    def ask_web_endpoint(req: WebAskRequest) -> dict:
        from self_learn import ask_web_generate, learn_in_background, pending, record_experience, self_learn_enabled

        model: ShamSmall = state["model"]
        tokenizer: ShamTextTokenizer = state["text_tokenizer"]
        question = (req.question or "").strip()
        if not question:
            return {"answer": "", "sources": "", "hits": 0, "queued": False, "reason": "empty question"}
        answer, hits, sources = ask_web_generate(model, tokenizer, question, max_new_tokens=req.max_new_tokens, use_chat_wrap=True)
        result = {"answer": answer, "sources": sources, "hits": len(hits), "queued": False}
        if not (req.learn and self_learn_enabled()):
            return result
        rec = record_experience(question, hits, sources)
        result.update(queued=rec["queued"], pending=rec.get("pending", pending()))
        if not rec["queued"]:
            result["reason"] = rec.get("reason", "")
        elif learn_in_background(state):
            result["learning_started"] = True
        return result
