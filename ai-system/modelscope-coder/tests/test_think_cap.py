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
print("OK")
