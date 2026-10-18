#!/usr/bin/env python3
"""Merge the site's environment (JSON from /api/ops/env-sync) into a docker-compose .env file. Usage: envmerge.py in.json .env .env.production
Keeps every existing name the new set does not have, replaces the others, writes mode 600, keeps one backup, prints only a count."""
import json, os, re, shutil, sys

src, envf, prod = sys.argv[1:4]
new = json.load(open(src)).get("env") or {}
if not isinstance(new, dict) or not new.get("DATABASE_URL"):
    sys.exit("no DATABASE_URL in the answer: refusing to merge")

def quote(v: str) -> str:
    # compose .env: single quotes are literal; fall back to double quotes (with $ doubled) when the value has a quote or a newline
    if "'" not in v and "\n" not in v and "\r" not in v:
        return "'" + v + "'"
    return '"' + v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "").replace("$", "$$") + '"'

lines, seen = [], set()
if os.path.exists(envf):
    shutil.copy2(envf, envf + ".bak")
    for ln in open(envf).read().splitlines():
        m = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)=", ln)
        if m and m.group(1) in new:
            if m.group(1) not in seen:
                lines.append(f"{m.group(1)}={quote(str(new[m.group(1)]))}"); seen.add(m.group(1))
            continue
        lines.append(ln)
for k, v in new.items():
    if k not in seen:
        lines.append(f"{k}={quote(str(v))}")
open(envf, "w").write("\n".join(lines) + "\n"); os.chmod(envf, 0o600)

pub = [f"{k}={quote(str(v))}" for k, v in new.items() if k.startswith("NEXT_PUBLIC_")]
open(prod, "w").write("\n".join(pub) + "\n"); os.chmod(prod, 0o600)
print(f"{len(new)} variables")
