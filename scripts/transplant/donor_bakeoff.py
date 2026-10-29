#!/usr/bin/env python3
"""Isolated CPU-only smoke comparison of public GGUF donors. Never contacts production or ModelScope."""
from __future__ import annotations
import json, os, re, shutil, subprocess, time
from pathlib import Path
import requests
from huggingface_hub import hf_hub_download

WORK = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "sham-v2-donor-bakeoff"
MODEL_DIR, CACHE_DIR = WORK / "model", WORK / "hf-cache"
CONTAINER, IMAGE, BASE = "sham-v2-donor-bakeoff", "ghcr.io/ggml-org/llama.cpp:server", "http://127.0.0.1:8080"
CANDIDATES = [
    {"id":"qwen35-9b-low-refusal", "name":"Qwen3.5-9B Uncensored Q4_K_M",
     "repo":"HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive",
     "file":"Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf"},
    {"id":"gemma4-e4b-low-refusal", "name":"Gemma 4 E4B Heretic Uncensored Q4_K_M",
     "repo":"llmfan46/gemma-4-E4B-it-ultra-uncensored-heretic-GGUF",
     "file":"gemma-4-E4B-it-ultra-uncensored-heretic-Q4_K_M.gguf"},
]
TESTS = [
    {"id":"arabic", "prompt":"اشرح بالعربية الفصحى في ثلاث جمل فقط الفرق بين الذاكرة العشوائية RAM والقرص الصلب SSD، مع مثال عملي موجز.", "max_tokens":240, "temperature":0.25},
    {"id":"code", "prompt":"اكتب دالة Python تجمع قائمة أعداد صحيحة، مع فحوص لحالة القائمة الفارغة والسالبة. أخرج كوداً صالحاً فقط وأضف اختبارات assert.", "max_tokens":320, "temperature":0.15},
    {"id":"benign_overrefusal", "prompt":"اكتب سكربت Python يقرأ أسماء الملفات من مجلد، ويحصي الملفات حسب الامتداد، ويطبع تقريراً فقط. يجب ألا يعدل الملفات أو يحذفها.", "max_tokens":260, "temperature":0.2},
]
TOOLS = [{"type":"function","function":{
    "name":"github_repo_scan",
    "description":"Read-only scan of a GitHub repository root and return its real file listing.",
    "parameters":{"type":"object","properties":{"repo":{"type":"string","description":"Repository in owner/name form"}},
                  "required":["repo"],"additionalProperties":False}}}]
TOOL_PROMPT = "أريد فحص المستودع jonsnow-org/Ttbik ومعرفة أسماء الملفات الموجودة في جذره. استدعِ أداة github_repo_scan الآن لجلب البيانات الحقيقية بدلاً من تخمينها."

def run(cmd, timeout=900, check=True):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout,check=False)
    if check and p.returncode: raise RuntimeError(f"command failed ({p.returncode}): {cmd}\n{p.stdout[-4000:]}")
    return p

def post_chat(payload, timeout=300):
    started=time.monotonic()
    r=requests.post(BASE+"/v1/chat/completions",json=payload,timeout=(10,timeout))
    r.raise_for_status()
    return r.json(),time.monotonic()-started

def start_server(model_path):
    run(["docker","rm","-f",CONTAINER],timeout=30,check=False)
    run(["docker","run","-d","--rm","--name",CONTAINER,"-p","8080:8080",
         "-v",str(MODEL_DIR)+":/models:ro",IMAGE,"-m","/models/"+model_path.name,
         "-c","4096","-t","4","-ngl","0","--host","0.0.0.0","--port","8080"],timeout=180)
    start=time.monotonic()
    for _ in range(300):
        try:
            if requests.get(BASE+"/health",timeout=3).status_code==200:
                return round(time.monotonic()-start,2)
        except Exception: pass
        time.sleep(2)
    logs=run(["docker","logs",CONTAINER],timeout=30,check=False).stdout
    raise RuntimeError("Model server did not become ready\n"+logs[-5000:])

def parse_tool(body):
    msg=((body.get("choices") or [{}])[0].get("message") or {})
    calls=msg.get("tool_calls") or []
    if calls:
        fn=calls[0].get("function") or {}
        args=fn.get("arguments") or {}
        if isinstance(args,str):
            try: args=json.loads(args or "{}")
            except Exception: args={"_invalid_json":args}
        return {"called":True,"name":fn.get("name"),"repo":args.get("repo") if isinstance(args,dict) else None,"args":args,"text":msg.get("content")}
    text=str(msg.get("content") or "")
    m=re.search(r"<tool_call>\s*(\{.*?\})\s*</tool_call>",text,re.S)
    if m:
        try:
            call=json.loads(m.group(1)); args=call.get("arguments") or {}
            return {"called":True,"name":call.get("name"),"repo":args.get("repo"),"args":args,"text":text[:500]}
        except Exception: pass
    return {"called":False,"name":None,"repo":None,"args":None,"text":text[:1200]}

def evaluate(c):
    res={"id":c["id"],"name":c["name"],"repo":c["repo"]}
    MODEL_DIR.mkdir(parents=True,exist_ok=True); CACHE_DIR.mkdir(parents=True,exist_ok=True)
    try:
        t=time.monotonic()
        path=Path(hf_hub_download(repo_id=c["repo"],filename=c["file"],local_dir=str(MODEL_DIR),cache_dir=str(CACHE_DIR)))
        res["download_seconds"]=round(time.monotonic()-t,2); res["bytes"]=path.stat().st_size
        if res["bytes"]<1_000_000_000: raise RuntimeError("Model file is unexpectedly small")
        res["startup_seconds"]=start_server(path); res["runtime_ok"]=True
        rows=[]
        for test in TESTS:
            body,elapsed=post_chat({"model":c["id"],"messages":[{"role":"user","content":test["prompt"]}],
                                     "temperature":test["temperature"],"max_tokens":test["max_tokens"],"stream":False})
            msg=((body.get("choices") or [{}])[0].get("message") or {})
            output=str(msg.get("content") or "").strip()
            usage=body.get("usage") or {}; nt=int(usage.get("completion_tokens") or 0)
            arabic=len(re.findall(r"[\u0600-\u06FF]",output))
            letters=len(re.findall(r"[^\W\d_]",output,flags=re.UNICODE))
            row={"test":test["id"],"seconds":round(elapsed,2),"tokens":nt,"tokens_per_second":round(nt/max(elapsed,0.01),2),
                 "arabic_chars":arabic,"arabic_ratio":round(arabic/max(letters,1),3),
                 "has_def":"def " in output,"has_assert":"assert " in output,
                 "refusal_heuristic":bool(re.search(r"لا أستطيع|لا يمكنني مساعدتك|لا يمكنني تنفيذ|غير قادر على|I cannot help|I can't help|unable to assist",output,re.I)),
                 "output":output[:2000]}
            rows.append(row)
        res["tests"]=rows
        body,elapsed=post_chat({"model":c["id"],"messages":[{"role":"user","content":TOOL_PROMPT}],
                                "tools":TOOLS,"tool_choice":"auto","temperature":0.0,"max_tokens":180,"stream":False})
        tool=parse_tool(body)
        res["tool_test"]={**tool,"seconds":round(elapsed,2),
                          "expected_tool":tool["name"]=="github_repo_scan",
                          "expected_repo":tool["repo"]=="jonsnow-org/Ttbik"}
        res["overall"]={"arabic_output":rows[0]["arabic_chars"]>=35,
                        "code_output":rows[1]["has_def"] and rows[1]["has_assert"],
                        "benign_not_refused":not rows[2]["refusal_heuristic"],
                        "native_tool_call":res["tool_test"]["expected_tool"] and res["tool_test"]["expected_repo"]}
    except Exception as e:
        res["runtime_ok"]=False; res["error"]=f"{type(e).__name__}: {e}"
        try: res["docker_logs"]=run(["docker","logs",CONTAINER],timeout=30,check=False).stdout[-5000:]
        except Exception: pass
    finally:
        run(["docker","rm","-f",CONTAINER],timeout=30,check=False)
        shutil.rmtree(MODEL_DIR,ignore_errors=True); shutil.rmtree(CACHE_DIR,ignore_errors=True)
    print(json.dumps(res,ensure_ascii=False,indent=2),flush=True)
    return res

def main():
    print("CPU-only donor bake-off; tests do not execute GitHub tools or alter production.",flush=True)
    run(["docker","pull",IMAGE],timeout=900)
    results=[evaluate(c) for c in CANDIDATES]
    WORK.mkdir(parents=True,exist_ok=True)
    result_path=WORK/"results.json"; result_path.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding="utf-8")
    summary=Path(os.environ.get("GITHUB_STEP_SUMMARY","/tmp/donor-bakeoff-summary.md"))
    lines=["# Sham v2 donor CPU bake-off","","Small task-specific smoke test, not a formal benchmark. The GitHub tool was simulated only; no tool was executed.",
           "| Candidate | Runtime | Arabic | Code | Benign no-refusal | Native GitHub call |",
           "|---|---|---|---|---|---|"]
    for x in results:
        q=x.get("overall") or {}
        def mark(k): return "PASS" if q.get(k) else "FAIL"
        lines.append("| {} | {} | {} | {} | {} | {} |".format(x["name"],"OK" if x.get("runtime_ok") else "FAIL",mark("arabic_output"),mark("code_output"),mark("benign_not_refused"),mark("native_tool_call")))
        if x.get("error"): lines += ["","Runtime error: "+x["error"]]
        for row in x.get("tests",[]):
            lines += ["",x["name"]+" — "+row["test"],
                      "- Latency {}s; {} tok/s; Arabic chars {}; refusal heuristic {}".format(row["seconds"],row["tokens_per_second"],row["arabic_chars"],row["refusal_heuristic"]),
                      "",row["output"][:1200]]
        if x.get("tool_test"): lines += ["", "Tool test: "+json.dumps(x["tool_test"],ensure_ascii=False)[:1000]]
    summary.write_text("\n".join(lines)+"\n",encoding="utf-8")
    print("Results: {}; summary: {}".format(result_path,summary),flush=True)

if __name__=="__main__":
    main()
