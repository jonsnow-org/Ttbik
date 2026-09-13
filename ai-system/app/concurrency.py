"""
Extracted from council.py, 2026-09-13, once rag.py needed the exact same
real fix deep_think.py's own hard-latency incident required — see
with_hard_deadline's own docstring for the underlying bug this closes.
council.py's three original call sites (image/video generation, our own
model's text answer) are unchanged in behavior; this is a pure move, not
a rewrite, so a second, slightly different copy never has to be kept in
sync by hand.
"""
import concurrent.futures
import logging

logger = logging.getLogger("nova")


def with_hard_deadline(fn, *args, timeout: float, **kwargs):
    """Owner report, 2026-09-09 (real evidence: a plain "مرحبا" got ZERO
    reply for minutes, not even a fallback error message): a real,
    well-known gotcha with requests' `timeout=` on a streamed (SSE)
    response — it bounds each individual socket read, not the total
    call duration. If a provider sends periodic keepalive bytes while a
    job is genuinely stalled, every single read succeeds well within its
    own timeout and iter_lines() keeps going indefinitely — the nominal
    timeout on the wrapped call never actually fires, so its own
    fallback (or an honest failure message) never runs either, leaving
    the user with silence forever.

    Owner report, 2026-09-13 (real evidence: "قارن لي بين طريقتين..."
    got zero reply, not even an error, well past a minute): the exact
    same failure mode resurfaced once deep_think.py started chaining
    several real network calls (Groq for plan/draft/critique, then
    rag.web_search, then our own model) BEFORE the one call that already
    had this protection — any one of the earlier, unprotected steps
    hanging blocks everything after it, silently, with no bound at all.

    This runs `fn` in a separate thread and gives up waiting after
    `timeout` seconds REGARDLESS of what the socket is doing — the
    caller gets None back and can fall through to a fallback or a real
    error message on schedule. The abandoned thread is not killed
    (Python has no safe way to do that) — it either finishes on its own
    later and its result is discarded, or the underlying call eventually
    hits its own timeout and dies there. Either way this function's
    caller is never blocked past `timeout`."""
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = pool.submit(fn, *args, **kwargs)
    try:
        return future.result(timeout=timeout)
    except concurrent.futures.TimeoutError:
        logger.warning("hard deadline (%ss) hit waiting on %s — treating as unavailable", timeout, getattr(fn, "__name__", fn))
        return None
    finally:
        pool.shutdown(wait=False)
