"""Sham Pro's coordinator, wired to Sham Pro's OWN Studio (one model, one Studio: no other model's address is ever used).

    from sham_pro_agent import build
    c = build(folder, studio_url, token)           # a Coordinator with shell/file/app_tool/ask_user and see/hear/write/make
    t = c.run(c.new_task("describe photo.png and write a short report"))

see/hear read through the Studio's `understand_media`, write uses `generate_chat`, make uses `generate_media` (Sham Pro's own internal generator, judged by the media
quality gate). The planner is Sham Pro's own chat (`generate_chat`), asked for a JSON plan; whatever it returns is still refused step by step by the coordinator
(unknown worker, no check, credential-like argument), so a bad plan never runs. Nothing here is imported by a live path yet: this is the adapter + entry the app can call.
"""
from __future__ import annotations

import json
import re

from media_workers import GradioMedia, install
from tasks import Coordinator

PLAN_PROMPT = """You plan a task for a coordinator. Reply with ONLY a JSON list of steps. Each step: {{"id": "s1", "kind": one of shell|file|see|hear|write|make, "args": {{...}}, "needs": [ids], "check": {{...}}}}.
Every step MUST have a check: {{"file": "name", "has": "text"}} or {{"file": "name", "quality": true}} (for generated pictures/sound) or {{"exit0": true}} (for shell).
see: args {{"media": "image|video", "file": "name", "question": "..."}}; hear: args {{"file": "name"}}; write: args {{"prompt": "..."}}; make: args {{"media": "image|audio", "prompt": "..."}}.
Goal: {goal}"""


def _json_list(text: str) -> list:
    m = re.search(r"\[.*\]", text or "", re.S)
    try:
        v = json.loads(m.group(0)) if m else []
    except ValueError:
        return []
    return [d for d in v if isinstance(d, dict) and isinstance(d.get("kind"), str)] if isinstance(v, list) else []


class StudioPlanner:
    def __init__(self, media: GradioMedia):
        self.media = media

    def plan(self, goal: str) -> list:
        return _json_list(self.media.text(PLAN_PROMPT.format(goal=goal), 600))

    def replan(self, goal: str, task, failed) -> list:
        why = f"The step {failed.id} ({failed.kind}) failed: {failed.result[:200]}. Plan replacement steps only for it."
        return _json_list(self.media.text(PLAN_PROMPT.format(goal=goal + " | " + why), 600))


def build(folder: str, studio_url: str, token: str, **kw) -> Coordinator:
    media = GradioMedia(studio_url, token)
    c = Coordinator(folder, StudioPlanner(media), **kw)
    install(c, media)
    return c
