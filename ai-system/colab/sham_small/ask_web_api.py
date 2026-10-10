"""Sham — /ask/web FastAPI routes (wired from serve.py)."""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

from model import ShamSmall
from text_tokenizer import ShamTextTokenizer


class WebAskRequest(BaseModel):
    """Live web search + grounded answer; optional self-learn weight step."""
    question: str
    max_new_tokens: int = 60
    learn: bool = False


def register_ask_web(app: FastAPI, state: dict) -> None:
    """Attach POST /ask/web onto the serve.py FastAPI app."""

    @app.post("/ask/web")
    def ask_web_endpoint(req: WebAskRequest) -> dict:
        """Search the live web, answer with sources in context, optionally learn.

        learn=true only updates weights when SHAM_SELF_LEARN=1 and search returned
        hits; the new checkpoint is written to SHAM_SELF_LEARN_SAVE_PATH (never final_chat.pt). Media ask/generate routes also support learn=true
        via self_learn multimodal helpers.
        """
        from self_learn import (
            ask_web_generate,
            grounded_target_answer,
            learn_from_turn,
            self_learn_enabled,
        )

        model: ShamSmall = state["model"]
        tokenizer: ShamTextTokenizer = state["text_tokenizer"]
        question = (req.question or "").strip()
        if not question:
            return {"answer": "", "sources": "", "hits": 0, "learned": False, "reason": "empty question"}

        answer, hits, sources = ask_web_generate(
            model, tokenizer, question, max_new_tokens=req.max_new_tokens, use_chat_wrap=True,
        )
        result = {
            "answer": answer,
            "sources": sources,
            "hits": len(hits),
            "learned": False,
        }
        if not req.learn:
            return result
        if not self_learn_enabled():
            result["reason"] = "SHAM_SELF_LEARN is not enabled"
            return result
        if not hits:
            result["reason"] = "no search hits — refused to learn from ungrounded turn"
            return result

        target = grounded_target_answer(question, hits, answer)
        learn_out = learn_from_turn(
            model,
            tokenizer,
            question,
            target,
            current_step=int(state.get("train_step") or 0),
            served_checkpoint=state.get("checkpoint_path"),
            tokenizer_path=state.get("tokenizer_path"),
            device="cpu",
        )
        if learn_out.get("learned"):
            state["train_step"] = learn_out["step"]
            result["learned"] = True
            result["learn"] = {
                "loss": learn_out["metrics"]["loss"],
                "step": learn_out["step"],
                "checkpoint": learn_out["checkpoint"]["path"],
            }
        else:
            result["reason"] = learn_out.get("reason", "learn failed")
        return result
