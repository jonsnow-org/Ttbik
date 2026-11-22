#!/usr/bin/env python3
"""Read-only: from INSIDE the Nova computer hub, which sites answer? (owner 2026-11-22: no page opens in any model's computer). Prints host, HTTP code, seconds."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelscope_computer_smoke as smoke  # noqa: E402

API = os.environ.get("HUB_API", "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net")
HOSTS = ["example.com", "www.google.com", "www.youtube.com", "github.com", "api.github.com", "raw.githubusercontent.com", "cn.bing.com", "www.bing.com", "www.baidu.com",
         "duckduckgo.com", "en.wikipedia.org", "pypi.org", "registry.npmjs.org", "huggingface.co", "hf-mirror.com", "modelscope.cn", "modelscope.ai", "api.telegram.org",
         "workers.dev", "vercel.app", "cloudflare.com", "1.1.1.1", "mirrors.aliyun.com", "pypi.tuna.tsinghua.edu.cn"]
tok = (os.environ.get("MODELSCOPE_TOKEN") or "").strip()
cmd = "for h in " + " ".join(HOSTS) + "; do r=$(curl -sS -o /dev/null -m 8 -w '%{http_code} %{time_total}' https://$h/ 2>&1 | tail -1); echo \"$h => $r\"; done; echo ---; env | grep -i proxy | sed 's/=.*/=<set>/'; echo ---; cat /etc/resolv.conf | head -3; curl -sS -m 6 https://ifconfig.me 2>&1 | tail -1"
r = smoke.box_call(API, tok, {"session": "check:netprobe", "action": "run", "command": cmd}, timeout=180)
print(str(r.get("output") or json.dumps(r, ensure_ascii=False))[:6000])
