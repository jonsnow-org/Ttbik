"""Web-learning stage of self-evolution (TRAINING data only; at work time the model browses freely, see __init__.py).

  gaps = knowledge_gaps(failures, known_commands)      # commands/families the model failed on or has never seen (driven by its OWN failure clusters)
  pages = WebFetcher(cache_dir).fetch_sources(gaps)    # free public sources, robots.txt honoured, 1 request/s per host, cached on disk
  cands = extract(pages)                               # candidate (task, command) pairs; fetched text is DATA: parsed by regex, never followed as instructions
  kept, report = verify_and_filter(cands, ...)         # licence allow-list, injection screen, PII scrub, dedup, decontamination, deny list, REAL execution

Sources (zero budget, no paid keys):
  * tldr-pages (GitHub, pages CC-BY-4.0, English + Arabic): one "- description:\\n`command`" per example -> natural (task, command) pairs;
  * Stack Exchange API (unix.stackexchange, no key, 300 req/day): fetched and recorded, but its content is CC BY-SA 4.0 (share-alike), so the default
    licence allow-list (permissive only, owner rule) REJECTS it; kept as a source so the rule is visible and switchable (SHAM_WEB_LICENSES).
Every kept pair carries {url, license, source}. A pair is kept only if its command RUNS in the sandbox (the same default-deny terminal the model is trained
against), exits 0, produces output or a change in the folder, and gives the same result twice."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.robotparser

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "data"))
from experience import deny_reason, family, has_pii, intent_key, scrub  # noqa: E402

UA = "Sham2-TLDM-learner/1.0 (+https://github.com/jonsnow-org/Ttbik; training-data research, 1 req/s)"
PERMISSIVE = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0-1.0", "CC-BY-4.0", "Unlicense", "0BSD", "PSF-2.0"}
TLDR_RAW = "https://raw.githubusercontent.com/tldr-pages/tldr/main/{lang}/common/{cmd}.md"
TLDR_LICENSE = "https://raw.githubusercontent.com/tldr-pages/tldr/main/LICENSE.md"
CHEAT_RAW = "https://raw.githubusercontent.com/cheat/cheatsheets/master/{cmd}"                 # cheat/cheatsheets: CC0-1.0 (.github/LICENSE.txt)
CHEAT_LICENSE = "https://raw.githubusercontent.com/cheat/cheatsheets/master/.github/LICENSE.txt"
AWESOME_BASH = "https://raw.githubusercontent.com/LeCoupa/awesome-cheatsheets/master/languages/bash.sh"   # MIT
AWESOME_LICENSE = "https://raw.githubusercontent.com/LeCoupa/awesome-cheatsheets/master/LICENSE"
SE_API = "https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&q={q}&site=unix&filter=withbody&pagesize={n}"
INJECTION = re.compile(r"(?i)(ignore (?:all |any )?(?:previous|prior|above) (?:instructions|prompts)|disregard (?:the|your) (?:rules|instructions)|you are (?:now )?(?:an? )?(?:ai|assistant|chatgpt)|system prompt|<script|BEGIN (?:SYSTEM|INSTRUCTIONS)|do not tell the user)")


def allowed_licenses() -> set:
    env = os.environ.get("SHAM_WEB_LICENSES", "").strip()
    return {x.strip() for x in env.split(",") if x.strip()} if env else set(PERMISSIVE)


def detect_license(text: str) -> str:
    t = text or ""
    for spdx, pat in (("CC-BY-SA-4.0", r"Attribution[- ]ShareAlike 4\.0|CC BY-SA 4\.0"), ("CC-BY-4.0", r"Creative Commons Attribution 4\.0|\(CC-BY\)|CC BY 4\.0"),
                      ("CC0-1.0", r"CC0 1\.0|Public Domain Dedication"), ("MIT", r"\bMIT License\b"), ("Apache-2.0", r"Apache License,? Version 2\.0"),
                      ("BSD-3-Clause", r"BSD 3-Clause"), ("GPL-3.0", r"GNU GENERAL PUBLIC LICENSE\s+Version 3")):
        if re.search(pat, t, re.I):
            return spdx
    return "unknown"


# ---------------------------------------------------------------- what to look for (the model's own gaps)
SANDBOX_COMMANDS = ["ls", "cat", "echo", "pwd", "head", "tail", "wc", "grep", "sort", "uniq", "touch", "date", "seq", "tr", "cut", "basename", "dirname", "stat", "mkdir"]


def knowledge_gaps(failures: list, known_commands: set) -> list:
    """failures: [(task, wrong_command, reference_or_None)]. -> command names to learn about, most-needed first: the commands of failed tasks (from the reference
    when the verifier knew it, else from the wrong attempt), then sandbox commands the model was never trained on."""
    need: dict = {}
    for task, wrong, ref in failures:
        for c in (ref, wrong):
            for seg in (c or "").split("|"):
                w = seg.strip().split()
                if w and w[0] in SANDBOX_COMMANDS:
                    need[w[0]] = need.get(w[0], 0) + (2 if c is ref else 1)
    ranked = sorted(need, key=lambda k: -need[k])
    return ranked + [c for c in SANDBOX_COMMANDS if c not in need and c not in known_commands]


# ---------------------------------------------------------------- polite fetching
class WebFetcher:
    def __init__(self, cache_dir: str, min_interval: float = 1.0, offline: bool = False):
        self.cache_dir, self.min_interval, self.offline = cache_dir, min_interval, offline
        os.makedirs(cache_dir, exist_ok=True)
        self._last: dict = {}
        self._robots: dict = {}
        self.log: list = []

    def _allowed(self, url: str) -> bool:
        host = urllib.parse.urlsplit(url)
        base = f"{host.scheme}://{host.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser(base + "/robots.txt")
            try:
                req = urllib.request.Request(base + "/robots.txt", headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=10) as r:
                    rp.parse(r.read().decode("utf-8", "replace").splitlines())
            except Exception:                                       # no robots.txt (404) = allowed, per the robots convention
                rp.parse([])
            self._robots[base] = rp
        return self._robots[base].can_fetch(UA, url)

    def get(self, url: str) -> str | None:
        key = os.path.join(self.cache_dir, hashlib.sha256(url.encode()).hexdigest()[:24] + ".txt")
        if os.path.exists(key):
            return open(key, encoding="utf-8").read()
        if self.offline:
            return None
        if not self._allowed(url):
            self.log.append({"url": url, "skipped": "robots.txt"})
            return None
        host = urllib.parse.urlsplit(url).netloc
        wait = self.min_interval - (time.time() - self._last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        self._last[host] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=15) as r:
                body = r.read()
            if body[:2] == b"\x1f\x8b":
                import gzip
                body = gzip.decompress(body)
            text = body.decode("utf-8", "replace")
        except Exception as e:                                      # 404 etc.: recorded, not fatal
            self.log.append({"url": url, "error": type(e).__name__})
            text = ""
        with open(key, "w", encoding="utf-8") as f:
            f.write(text)
        return text

    def fetch_sources(self, gaps: list, langs=("pages", "pages.ar"), se_queries: int = 0) -> list:
        """-> [{"source", "url", "license", "text"}] for the gap commands (tldr EN/AR), plus `se_queries` Stack Exchange searches."""
        lic_text = self.get(TLDR_LICENSE) or ""
        tldr_lic = detect_license(lic_text)
        pages = []
        for cmd in gaps:
            for lang in langs:
                url = TLDR_RAW.format(lang=lang, cmd=cmd)
                t = self.get(url)
                if t:
                    pages.append({"source": "tldr-pages", "url": url, "license": tldr_lic, "text": t, "lang": lang})
        cheat_lic = detect_license(self.get(CHEAT_LICENSE) or "")
        for cmd in gaps:
            url = CHEAT_RAW.format(cmd=cmd)
            t = self.get(url)
            if t:
                pages.append({"source": "cheat/cheatsheets", "url": url, "license": cheat_lic, "text": t, "lang": "pages"})
        t = self.get(AWESOME_BASH)
        if t:
            pages.append({"source": "awesome-cheatsheets", "url": AWESOME_BASH, "license": detect_license(self.get(AWESOME_LICENSE) or ""), "text": t, "lang": "pages"})
        for cmd in gaps[:se_queries]:
            url = SE_API.format(q=urllib.parse.quote(f"{cmd} command"), n=3)
            t = self.get(url)
            if t:
                pages.append({"source": "unix.stackexchange", "url": url, "license": "CC-BY-SA-4.0", "text": t, "lang": "pages"})
        return pages


# ---------------------------------------------------------------- extraction (fetched text is data)
FIXTURE_FILES = {"file": ["app.log", "names.txt", "README.md"], "directory": ["."], "pattern": ["ERROR", "INFO"]}


def _instantiate(cmd: str, i: int):
    """tldr placeholders -> concrete sandbox arguments; None if a placeholder is not understood (the pair is dropped, never guessed)."""
    used = {}

    def rep(m):
        inner = m.group(1)
        opt = re.fullmatch(r"\[(-\w+)\|--[\w-]+\]", inner) or re.fullmatch(r"\[(-\w)\|--[\w-]+\]", inner)
        if opt:
            return opt.group(1)
        if re.fullmatch(r"-\w+|--[\w-]+", inner):
            return inner
        low = inner.lower()
        if re.search(r"dirname|new_?dir|path/to/new", low):
            v = "newdir"
        elif re.search(r"path/to/(?:input_)?file\d*$|^(?:input)?file(?:name)?\d*$|path/to/file\d*\.\w+|^filenames?$", low):
            v = FIXTURE_FILES["file"][(i + len(used)) % 3]
        elif re.search(r"directory|folder", low):
            v = "."
        elif re.search(r"pattern|search_string|string", low):
            v = FIXTURE_FILES["pattern"][i % 2]
        elif re.fullmatch(r"\d+|count|n|number|num_lines", low):
            v = inner if inner.isdigit() else "3"
        else:
            return "\x00"
        used[inner] = v
        return v

    cmd = re.sub(r"<([\w./-]+)>", r"{{\1}}", cmd)                     # cheat-sheet style <file> placeholders
    out = re.sub(r"\{\{(.*?)\}\}", rep, cmd)
    return (None, None) if "\x00" in out else (out, used)


def _pairs(desc: str, cmd: str, p: dict, n_files: int = 3) -> list:
    """One example -> up to n_files pairs (the same example instantiated on each fixture file: more, and more varied, training rows)."""
    out, seen = [], set()
    for i in range(n_files):
        c, used = _instantiate(cmd, i)
        if not c or c in seen:
            continue
        seen.add(c)
        task = re.sub(r"`", "", desc).strip().rstrip(":")
        for ph, v in (used or {}).items():                          # placeholders written in the description itself (<file>, <number>)
            task = task.replace("<" + ph + ">", v).replace("{{" + ph + "}}", v)
        task = re.sub(r"<(?:number|n|count|num)>", "3", task)
        if re.search(r"<[\w./-]+>", task):
            continue
        task = task[0].lower() + task[1:] if task[:1].isupper() and not task[:2].isupper() else task
        files = [v for v in (used or {}).values() if "." in v and v != "."]
        for f in files:                                             # the argument goes into the task, as a user would say it
            task2 = re.sub(r"\b(?:a|the|given|specific|your) (?:file|text file|filename)\b|\bملف\b", f, task, count=1)
            task = task2 if task2 != task else task + f" in {f}"
        out.append({"task": task[:64], "command": c, "url": p["url"], "license": p["license"], "source": p["source"]})
    return out


def extract(pages: list) -> list:
    """-> [{"task", "command", "url", "license", "source"}]. Pages with prompt-injection text are dropped whole (recorded)."""
    out = []
    for p in pages:
        text = p["text"]
        if INJECTION.search(text):
            out.append({"rejected": "prompt-injection text in the page", "url": p["url"]})
            continue
        if p["source"] == "tldr-pages":
            for desc, cmd in re.findall(r"^- (.+?):?\s*\n\s*\n`([^`\n]+)`", text, re.M):
                out += _pairs(desc, cmd, p)
        elif p["source"] == "cheat/cheatsheets":
            for desc, block in re.findall(r"^# (?:To )?(.+?):?[ \t]*\n((?:[^#\n][^\n]*\n?)+)", text, re.M):
                for cmd in block.strip().splitlines()[:2]:
                    out += _pairs(desc, re.sub(r"\s+#.*$", "", cmd).strip(), p)
        elif p["source"] == "awesome-cheatsheets":
            for cmd, desc in re.findall(r"^(\S[^#\n]*?)\s+#\s+([^\n]+)$", text, re.M):
                if cmd.split()[0] in SANDBOX_COMMANDS:
                    out += _pairs(desc.split(",")[0].split(". ")[0], cmd.strip(), p)
        elif p["source"] == "unix.stackexchange":
            try:
                items = json.loads(text).get("items", [])
            except ValueError:
                items = []
            for it in items:
                for code in re.findall(r"<code>([^<]{2,60})</code>", it.get("body", "")):
                    out.append({"task": it.get("title", "")[:64], "command": code.strip(), "url": it.get("link", p["url"]), "license": p["license"], "source": p["source"]})
    return out


def _sandbox():
    import terminal_tasks as T
    return T


def verify_and_filter(cands: list, heldout_tasks: list, block_fits=None, allowed: set | None = None) -> tuple:
    """-> (kept [{"task","command","family","url","license","source"}], report {reason: count}).
    heldout_tasks: every task text of every held-out / benchmark set (decontamination: no kept task may be equal to or share >= 0.4 of its words with one)."""
    T = _sandbox()
    allowed = allowed if allowed is not None else allowed_licenses()
    rep: dict = {}
    kept, seen = [], set()
    held = [set(re.findall(r"\w+", h.lower())) for h in heldout_tasks]
    held_keys = {intent_key(h) for h in heldout_tasks}

    def no(why):
        rep[why] = rep.get(why, 0) + 1

    for c in cands:
        if "rejected" in c:
            no(c["rejected"])
            continue
        if c["license"] not in allowed:
            no(f"licence {c['license']} not permissive")
            continue
        task, cmd = scrub(c["task"]), c["command"].strip()
        if has_pii(c["task"]) or not task.strip():
            no("personal data / empty task")
            continue
        if INJECTION.search(task) or INJECTION.search(cmd):
            no("prompt-injection text")
            continue
        if re.search(r"(?i)\bstdin\b|\$|(?:^|\s)-(?:\s|$)|%", task + " " + cmd):
            no("needs stdin / shell variables (not a self-contained task)")
            continue
        d = deny_reason(cmd)
        if d:
            no("deny: " + d)
            continue
        w = set(re.findall(r"\w+", task.lower()))
        if intent_key(task) in held_keys or any(w and len(w & h) / len(w | h) >= 0.4 for h in held):
            no("decontamination: too close to a held-out/benchmark task")
            continue
        k = (intent_key(task), cmd)
        if k in seen:
            no("duplicate")
            continue
        if block_fits and not block_fits(cmd):
            no("command longer than the writer's block")
            continue
        ok1, out1, snap1 = T.execute(cmd, confirm=False)
        if not ok1:
            no("did not run / non-zero exit in the sandbox")
            continue
        ok2, out2, snap2 = T.execute(cmd, confirm=False)
        base = T.execute("true")[2]
        if (out1, snap1) != (out2, snap2) and "<time>" not in out1:
            no("not deterministic")
            continue
        if not out1.strip() and snap1 == base:
            no("no output and no change")
            continue
        seen.add(k)
        kept.append({"task": task, "command": cmd, "family": family(cmd), "url": c["url"], "license": c["license"], "source": c["source"]})
    rep["kept"] = len(kept)
    return kept, rep
