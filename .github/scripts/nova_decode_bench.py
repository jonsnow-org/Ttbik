"""Times llama-server variants on two generations. Usage: nova_decode_bench.py <bin dir>. Prints one table; changes nothing."""
import json
import os
import subprocess
import sys
import time
import urllib.request

BIN = sys.argv[1]
PORT = 8081
CODE = "\n".join(f"def handler_{i}(request):\n    value = request.get('field_{i}', 0)\n    if value > {i}:\n        return {{'ok': True, 'id': {i}}}\n    return {{'ok': False, 'id': {i}}}\n" for i in range(24))
PROSE = [{"role": "system", "content": "You are a coding assistant."}, {"role": "user", "content": "Explain in about 120 words how a CSV parser with totals per column works."}]
EDIT = [{"role": "system", "content": "You are a coding assistant."}, {"role": "user", "content": "Rewrite this file exactly, but rename handler_3 to handle_three. Output only the code.\n\n" + CODE}]
BASE = ["-m", "model.gguf", "-c", "16384", "-t", "2", "-np", "1", "-n", "-1", "--jinja", "--reasoning-budget", "0", "--host", "127.0.0.1", "--port", str(PORT)]
VARIANTS = [
    ("baseline", []),
    ("ngram-simple", ["--spec-type", "ngram-simple"]),
    ("ngram-map-k", ["--spec-type", "ngram-map-k"]),
    ("ngram-mod", ["--spec-type", "ngram-mod"]),
    ("flash-attn on", ["-fa", "on"]),
    ("kv q8_0 + flash", ["-fa", "on", "-ctk", "q8_0", "-ctv", "q8_0"]),
    ("ubatch 1024 / batch 2048", ["-ub", "1024", "-b", "2048"]),
    ("draft 0.8B (max 8)", ["-md", "draft.gguf", "--draft-max", "8", "--draft-min", "2"]),
]


def post(messages, max_tokens):
    body = json.dumps({"messages": messages, "max_tokens": max_tokens, "temperature": 0, "stream": False, "cache_prompt": False}).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions", body, {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=900)).get("timings", {})


def run(name, extra):
    if name.startswith("draft") and not os.path.exists("draft.gguf"):
        return f"{name:28s} skipped (no draft file)"
    cmd = ["taskset", "-c", "0,1", os.path.join(BIN, "llama-server")] + BASE + extra
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        t0 = time.time()
        while time.time() - t0 < 180:
            if proc.poll() is not None:
                return f"{name:28s} server did not start: {(proc.stderr.read() or b'').decode()[-160:].strip()!r}"
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2)
                break
            except Exception:
                time.sleep(2)
        post(PROSE, 4)                                   # warm up
        p = post(PROSE, 160)
        e = post(EDIT, 420)
        return (f"{name:28s} prose {p.get('predicted_per_second', 0):5.1f} tok/s | edit {e.get('predicted_per_second', 0):5.1f} tok/s "
                f"(read {e.get('prompt_n', 0)} tok at {e.get('prompt_per_second', 0):5.1f} tok/s, wrote {e.get('predicted_n', 0)})")
    except Exception as ex:
        return f"{name:28s} error: {str(ex)[:140]}"
    finally:
        proc.terminate()
        try:
            proc.wait(20)
        except Exception:
            proc.kill()
        time.sleep(2)


for v in VARIANTS:
    print(run(*v), flush=True)
