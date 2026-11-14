"""HTTP access to Sham's embedded desktop, served by the model's OWN server (serve.py), so any client can show and touch the screen: the Mini App, a web page, anything that speaks HTTP.
Nothing here knows about ModelScope or the Mini App. Every call needs the token in SHAM_DESKTOP_TOKEN (header x-sham-desktop-token); with no token configured the endpoints refuse.
"""
from __future__ import annotations

import base64
import hmac
import json
import os
import time

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

import sham_desktop

router = APIRouter(prefix="/desktop", tags=["desktop"])


def _auth(token: str | None) -> None:
    expected = os.environ.get("SHAM_DESKTOP_TOKEN", "")
    if not expected or not token or not hmac.compare_digest(str(token), expected):
        raise HTTPException(status_code=401, detail="desktop token required")


class InputRequest(BaseModel):
    session: str
    action: str = "status"
    x: float | None = None
    y: float | None = None
    x2: float | None = None
    y2: float | None = None
    button: str | None = None
    text: str | None = None
    key: str | None = None
    direction: str | None = None
    amount: int | None = None
    app: str | None = None
    url: str | None = None
    width: int | None = None
    height: int | None = None


@router.post("/input")
def desktop_input(req: InputRequest, x_sham_desktop_token: str | None = Header(default=None)) -> dict:
    _auth(x_sham_desktop_token)
    args = {k: v for k, v in req.model_dump().items() if v is not None and k != "session"}
    return sham_desktop.serve_input(req.session, args)


@router.get("/frame")
def desktop_frame(session: str, x_sham_desktop_token: str | None = Header(default=None)) -> Response:
    _auth(x_sham_desktop_token)
    data = sham_desktop.serve_frame(session)
    if not data:
        raise HTTPException(status_code=404, detail="the desktop is not running")
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/stream")
def desktop_stream(session: str, seconds: int = Query(20, ge=1, le=25), x_sham_desktop_token: str | None = Header(default=None)) -> StreamingResponse:
    """Server-sent events: one JPEG frame (base64) about twice a second; the client reconnects when it ends."""
    _auth(x_sham_desktop_token)

    def events():
        end = time.time() + seconds
        while time.time() < end:
            data = sham_desktop.serve_frame(session)
            if data:
                yield "data: " + json.dumps({"screenshot_b64": base64.b64encode(data).decode("ascii"), "phase": "running"}) + "\n\n"
            else:
                yield "data: " + json.dumps({"phase": "stopped"}) + "\n\n"
                return
            time.sleep(0.5)
    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})
