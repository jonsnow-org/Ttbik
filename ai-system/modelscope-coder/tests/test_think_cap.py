import os
# Offline check of the Studio's thinking cap (run: python ai-system/modelscope-coder/tests/test_think_cap.py): a long thought is cut and the step is asked again with thinking off.
import http.server, json, threading, sys, time, importlib.util, os
os.environ["CODER_MODEL_PATH"]="/nonexistent"
spec = importlib.util.spec_from_file_location("app", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app.py"))
calls=[]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        think = body["chat_template_kwargs"]["enable_thinking"]; calls.append(think)
        self.send_response(200); self.send_header("Content-Type","text/event-stream"); self.end_headers()
        def ev(d): self.wfile.write(b"data: "+json.dumps(d).encode()+b"\n\n"); self.wfile.flush()
        try:
            if think:
                for i in range(200): ev({"choices":[{"delta":{"reasoning_content":"think "*20}}]}); time.sleep(0.005)
            else:
                ev({"choices":[{"delta":{"content":"the answer"}}]}); ev({"choices":[{"delta":{},"finish_reason":"stop"}],"timings":{"prompt_n":3,"predicted_n":3,"predicted_per_second":5}})
            self.wfile.write(b"data: [DONE]\n\n")
        except Exception: pass
srv=http.server.ThreadingHTTPServer(("127.0.0.1",0),H); threading.Thread(target=srv.serve_forever,daemon=True).start()
app=importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
app.LLAMA_PORT=srv.server_address[1]
job={"messages":[{"role":"user","content":"hi"}],"tools":[],"max_tokens":0,"think":True,"temperature":0.6,"status":"running","text":"","reasoning":"","created":time.time(),"seen":time.time()}
app._stream(job)
print("calls (think flag per request):",calls,"| text:",repr(job["text"]),"| thought_chars:",job.get("thought_chars"))
assert calls==[True,False] and job["text"]=="the answer"
# thinking that finishes inside the cap is left alone
calls.clear()
class H2(H):
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers["Content-Length"]))); calls.append(body["chat_template_kwargs"]["enable_thinking"])
        self.send_response(200); self.send_header("Content-Type","text/event-stream"); self.end_headers()
        def ev(d): self.wfile.write(b"data: "+json.dumps(d).encode()+b"\n\n"); self.wfile.flush()
        ev({"choices":[{"delta":{"reasoning_content":"short thought"}}]}); ev({"choices":[{"delta":{"content":"done"}}]}); self.wfile.write(b"data: [DONE]\n\n")
srv2=http.server.ThreadingHTTPServer(("127.0.0.1",0),H2); threading.Thread(target=srv2.serve_forever,daemon=True).start()
app.LLAMA_PORT=srv2.server_address[1]
job2=dict(job, think=True, text="", reasoning="", seen=time.time()); app._stream(job2)
print("short thought:",calls,repr(job2["text"])); assert calls==[True] and job2["text"]=="done"
# thinking that ends with NO answer and no tool call (everything written inside the thought) is asked again with thinking off
calls.clear()
class H3(H):
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers["Content-Length"]))); think=body["chat_template_kwargs"]["enable_thinking"]; calls.append(think)
        self.send_response(200); self.send_header("Content-Type","text/event-stream"); self.end_headers()
        def ev(d): self.wfile.write(b"data: "+json.dumps(d).encode()+b"\n\n"); self.wfile.flush()
        if think: ev({"choices":[{"delta":{"reasoning_content":"short thought with the answer inside"}}]})
        else: ev({"choices":[{"delta":{"content":"real answer"}}]})
        self.wfile.write(b"data: [DONE]\n\n")
srv3=http.server.ThreadingHTTPServer(("127.0.0.1",0),H3); threading.Thread(target=srv3.serve_forever,daemon=True).start()
app.LLAMA_PORT=srv3.server_address[1]
job3=dict(job, think=True, text="", reasoning="", seen=time.time(), tool_calls=[]); app._stream(job3)
print("empty thought:",calls,repr(job3["text"])); assert calls==[True,False] and job3["text"]=="real answer"
assert app._think_flag("1") == (True, 0) and app._think_flag("") == (False, 0) and app._think_flag("true") == (True, 0)
assert app._think_flag("1:500") == (True, 500) and app._think_flag("1:99999") == (True, 6000) and app._think_flag("1:5") == (True, 200) and app._think_flag("0:500") == (False, 500)
# vision is opt-in per Studio: a vision.on marker next to app.py (or CODER_VISION=on) switches it on, and a failed vision start switches it off again
import tempfile, pathlib
_here = app.HERE
with tempfile.TemporaryDirectory() as d:
    app.HERE = pathlib.Path(d)
    os.environ.pop("CODER_VISION", None); app._VIS.update(on=False, bad=False)
    assert app._vision_wanted() is False
    (app.HERE / "vision.on").write_text("on")
    assert app._vision_wanted() is True
    app._VIS["bad"] = True
    assert app._vision_wanted() is False, "a Studio whose vision start failed must not try again"
    app._VIS["bad"] = False; (app.HERE / "vision.on").unlink(); os.environ["CODER_VISION"] = "on"
    assert app._vision_wanted() is True
    os.environ.pop("CODER_VISION", None)
app.HERE = _here; app._VIS.update(on=False, bad=False)
assert app.STATE["vision"] is False
# conversation state on disk: keyed by the conversation's own start, saved after a long-enough job, restored when another conversation (or a restart) took the slot
import urllib.parse
slot_calls = []
class SH(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        act = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)["action"][0]
        slot_calls.append((act, body.get("filename")))
        if act == "save":
            (app.SLOT_DIR / body["filename"]).write_bytes(b"x" * 1000)
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b"{}")
srv4 = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SH); threading.Thread(target=srv4.serve_forever, daemon=True).start()
with tempfile.TemporaryDirectory() as d:
    _port, _dir, _keep = app.LLAMA_PORT, app.SLOT_DIR, app.SLOT_KEEP
    app.LLAMA_PORT = srv4.server_address[1]; app.SLOT_DIR = pathlib.Path(d); app.SLOT_KEEP = 2; app._LAST["conv"] = ""
    m1 = [{"role": "system", "content": "sys"}, {"role": "user", "content": "task A"}]
    m1b = m1 + [{"role": "assistant", "content": "a"}, {"role": "tool", "content": "r"}]
    m2 = [{"role": "system", "content": "sys"}, {"role": "user", "content": [{"type": "text", "text": "task B"}]}]
    assert app._conv_key(m1) == app._conv_key(m1b) != app._conv_key(m2), "same conversation = same key, even as it grows; parts are read"
    k1, k2 = app._conv_key(m1), app._conv_key(m2)
    app._slot_after({"conv": k1, "prefill": {"total": 2000}, "status": "done"})
    assert ("save", k1 + ".bin") in slot_calls and app._LAST["conv"] == k1
    app._slot_after({"conv": k2, "prefill": {"total": 300}, "status": "done"})
    assert ("save", k2 + ".bin") not in slot_calls, "a short prompt is cheap to read again: not saved"
    slot_calls.clear(); app._LAST["conv"] = k1; app._slot_before({"conv": k1}); assert slot_calls == [], "the slot already holds this conversation"
    app._LAST["conv"] = k2; job = {"conv": k1}; app._slot_before(job)
    assert slot_calls == [("restore", k1 + ".bin")] and job.get("slot_restored"), "another conversation took the slot: its state comes back"
    slot_calls.clear(); app._LAST["conv"] = ""; job = {"conv": "nofile"}; app._slot_before(job); assert slot_calls == [], "nothing saved for it: nothing to restore"
    for c in ("c2", "c3"):
        app._slot_after({"conv": c, "prefill": {"total": 2000}, "status": "done"}); time.sleep(0.02)
    assert len(list(app.SLOT_DIR.glob("*.bin"))) == 2, "only the newest conversations are kept on disk"
    app.LLAMA_PORT, app.SLOT_DIR, app.SLOT_KEEP = _port, _dir, _keep; app._LAST["conv"] = ""
print("OK")
