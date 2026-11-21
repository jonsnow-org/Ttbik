#!/usr/bin/env python3
"""The owner's device-mesh switch, end to end in a REAL browser (headless Chrome), against a real relay.

    python scripts/mesh/browser_switch_check.py --url https://sham-mesh.jonsnowx1r.workers.dev     # or a local `wrangler dev`

Serves the Mini App's own device code (src/lib/deviceMeshCore.ts + meshNode.ts, types stripped by Node) from a local origin, so every relay
call is a cross-origin browser request (CORS + WebCrypto Ed25519 as on a phone). The page's flag poll stands in for op mesh_flag. Checks:
  off -> the device does not join; on -> it joins (relay count +1); off -> it leaves (count back); on again -> same key rejoins.
Nothing is shown in the page (the app is silent); state is read through a /state beacon for this check only."""
from __future__ import annotations

import argparse
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PAGE = """<!doctype html><meta charset="utf-8"><title>device</title><script type="module">
import { createDeviceMesh } from "./deviceMeshCore.js";
const mem = {};
const ctl = createDeviceMesh({ url: %s,
  flag: async () => (await (await fetch("/flag?" + Date.now(), { cache: "no-store" })).json()).on,
  ownerCheck: async (c) => c.map(() => ""), visible: () => true,
  store: { get: (k) => mem[k] || "", set: (k, v) => { mem[k] = v; } }, pollMs: 2000, heartbeatMs: 8000 });
await ctl.sync("sham_v2");
setInterval(() => fetch("/state?" + encodeURIComponent(JSON.stringify(ctl.state()))).catch(() => 0), 1000);
</script>"""


def build(out: str, url: str) -> None:
    js = ("const m=require('node:module'),fs=require('fs'),p=require('path');"
          "const s=(f)=>m.stripTypeScriptTypes(fs.readFileSync(p.join(process.argv[1],'src/lib',f),'utf8'),{mode:'strip'});"
          "fs.writeFileSync(p.join(process.argv[2],'meshNode.js'),s('meshNode.ts'));"
          "fs.writeFileSync(p.join(process.argv[2],'deviceMeshCore.js'),s('deviceMeshCore.ts').replace('from \"./meshNode\"','from \"./meshNode.js\"'));")
    subprocess.run(["node", "--no-warnings", "-e", js, ROOT, out], check=True)
    open(os.path.join(out, "index.html"), "w").write(PAGE % json.dumps(url))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://sham-mesh.jonsnowx1r.workers.dev")
    ap.add_argument("--chrome", default=shutil.which("google-chrome") or shutil.which("chromium") or "google-chrome")
    a = ap.parse_args()
    d = tempfile.mkdtemp(prefix="meshweb_")
    build(d, a.url)
    st = {"flag": False, "state": {}}

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *x, **k):
            super().__init__(*x, directory=d, **k)

        def log_message(self, *x):
            pass

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            if u.path == "/flag":
                body = json.dumps({"on": st["flag"]}).encode()
            elif u.path == "/state":
                st["state"] = json.loads(urllib.parse.unquote(u.query))
                body = b"{}"
            else:
                return super().do_GET()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(body)

    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    page = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    chrome = subprocess.Popen([a.chrome, "--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={d}/prof", "--remote-debugging-port=0", page],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def health() -> int:
        req = urllib.request.Request(a.url.rstrip("/") + "/m/sham2/health", headers={"user-agent": "sham-mesh-client/1"})
        return int(json.loads(urllib.request.urlopen(req, timeout=15).read())["nodes_online"])

    def wait(cond, secs=40):
        end = time.time() + secs
        while time.time() < end:
            if cond():
                return True
            time.sleep(1)
        return False

    results, ids = [], []

    def check(name, ok, info):
        results.append(ok)
        print(("PASS " if ok else "FAIL ") + name + "  " + json.dumps(info), flush=True)
    try:
        wait(lambda: bool(st["state"]), 60)
        base = health()
        time.sleep(4)
        check("off: the device stays out", not st["state"].get("running") and health() == base, {"relay_nodes": health(), "page": st["state"]})
        st["flag"] = True
        ok = wait(lambda: st["state"].get("online") and health() >= base + 1)
        ids.append(st["state"].get("id"))
        check("on: the browser device joins the relay", ok, {"relay_nodes_before": base, "relay_nodes": health(), "page": st["state"]})
        st["flag"] = False
        ok = wait(lambda: not st["state"].get("running") and health() <= base)
        check("off: the device says bye and leaves", ok, {"relay_nodes": health(), "page": st["state"]})
        st["flag"] = True
        ok = wait(lambda: st["state"].get("online") and health() >= base + 1)
        ids.append(st["state"].get("id"))
        check("on again: the same device key rejoins", ok and ids[0] == ids[1] and bool(ids[0]), {"relay_nodes": health(), "ids_equal": ids[0] == ids[1]})
        st["flag"] = False
        wait(lambda: not st["state"].get("running"), 20)
    finally:
        chrome.terminate()
        srv.shutdown()
    print(f"{sum(results)}/{len(results)} passed")
    return 0 if all(results) and len(results) == 4 else 1


if __name__ == "__main__":
    sys.exit(main())
