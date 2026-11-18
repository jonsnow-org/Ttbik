"""Experience pipeline: every finished command of every user becomes ONE anonymised record; only verified, consensual, clean records may enter TRAINING.

    rec = make_record(user="u42", task="count the lines of /home/omar/app.log", command="wc -l /home/omar/app.log", exit_code=0,
                      stdout="6 app.log", stderr="", verdict=True, latency_s=0.03, model="sham2-tldm", adapter="count@v3", source="user")
    log = ExperienceLog("/mnt/workspace/sham_trainer/experience")
    log.add(rec)                       # -> "added" | "duplicate" | "rate_limited" | "rejected:<why>"
    pairs = log.admitted(min_consensus=2)   # [(task, command)] that may be trained on

Record schema (the user's raw text never leaves this function; what is stored is scrubbed):
    v, ts_day, user (salted hash), source (user|curriculum|web|mesh), intent (scrubbed task), intent_key (delexicalised template), command (scrubbed),
    exit_code, stdout_sha, stderr_sha, verdict (verifier: True/False/None), latency_s, model, adapter, family (task cluster), rid (record hash)

Defences against poisoning (training admission only):
  * verdict must be True AND exit_code 0 (a user's claim "it worked" without the verifier's yes is ignored);
  * the command must pass the owner's deny list and the sandbox's refused list (an admitted pair could teach the model a forbidden command);
  * adversarial patterns (credentials, network fetch-and-run, deleting outside the workspace, fork bombs) are rejected;
  * CONSENSUS: an (intent_key, command) pair is admitted only when >= k DISTINCT sources verified it (different users, or different sampling seeds);
  * one user may contribute at most `max_share` of the admitted pairs, and at most `per_user_per_day` records per day (rate limit);
  * records whose intent still contains PII after scrubbing are dropped.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "data"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "terminal"))

SCHEMA_VERSION = 1
SALT = os.environ.get("SHAM_EXPERIENCE_SALT", "sham2-experience")

# ---------------------------------------------------------------- PII scrubbing
_PII = [
    ("<email>", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")),
    ("<token>", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|ya29\.[\w-]{20,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,})\b")),
    ("<secret>", re.compile(r"(?i)(?<![<\w])(password|passwd|token|secret|api[_-]?key|bearer)\b(?:\s*[:=]\s*|\s+)(?!<)\S+")),
    ("<ip>", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    ("<ip>", re.compile(r"\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b", re.I)),
    ("<url>", re.compile(r"https?://\S+")),
    ("<phone>", re.compile(r"(?<![\w.])\+?\d[\d -]{8,}\d(?![\w.])")),
    ("<card>", re.compile(r"\b(?:\d[ -]?){13,16}\b")),
    ("<home>", re.compile(r"(?:/home|/Users|/root|C:\\Users)[/\\][^/\\\s]+")),
    ("<path>", re.compile(r"(?<![\w.])/(?:[\w.@-]+/)+")),            # absolute folders (the file name itself is kept: it is the task's argument)
]
_NAME_HINT = re.compile(r"(?i)\b(?:my name is|i am|i'm|this is|اسمي|أنا)\s+([A-Z\u0600-\u06FF][\w\u0600-\u06FF]+)")


def scrub(text: str, names: tuple = ()) -> str:
    """Removes e-mails, tokens/keys/passwords, IPs, URLs, phone/card numbers, home folders and absolute paths, self-introduced names and any `names` given
    (e.g. the user's display name from the session). Deterministic; idempotent."""
    t = text or ""
    for tag, pat in _PII:
        t = pat.sub(tag, t)
    t = _NAME_HINT.sub(lambda m: m.group(0).replace(m.group(1), "<name>"), t)
    for n in names:
        if n and len(n) > 1:
            t = re.sub(rf"(?i)(?<!\w){re.escape(n)}(?!\w)", "<name>", t)
    return t


def has_pii(text: str) -> bool:
    return scrub(text) != (text or "")


# ---------------------------------------------------------------- deny lists (training admission)
_ADVERSARIAL = [
    re.compile(r"\brm\s+-[a-z]*r[a-z]*f?\s+(?:/|~|\*|\.\.|\.(?:\s|$))"), re.compile(r":\(\)\s*\{\s*:\|:&\s*\};:"), re.compile(r"\b(?:curl|wget)\b[^|]*\|\s*(?:ba)?sh\b"),
    re.compile(r"\bbase64\s+-d\b.*\|\s*(?:ba)?sh"), re.compile(r"/etc/(?:passwd|shadow|sudoers)"), re.compile(r"\bmkfs\b|\bdd\s+if="), re.compile(r">\s*/dev/sd"),
    re.compile(r"(?i)ignore (?:all |the )?(?:previous|above) instructions"),
]


def owner_denylist() -> list:
    """The owner's deny list (applies to everyone): SHAM_TLDM_DENYLIST = a file with one entry per line (a command name, or `re:<regex>`)."""
    path = os.environ.get("SHAM_TLDM_DENYLIST", "")
    out = []
    if path and os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.split("#", 1)[0].strip()
            if line:
                out.append(re.compile(line[3:]) if line.startswith("re:") else re.compile(rf"(?:^|[|;&]\s*){re.escape(line)}\b"))
    return out


def _refused_words() -> set:
    try:
        from sandbox_terminal import REFUSED
        return set(REFUSED)
    except Exception:                                               # stdlib-only callers without the terminal folder: the adversarial patterns still apply
        return set()


def deny_reason(command: str) -> str:
    """'' = may be learned from; else why the command must never become training data."""
    c = (command or "").strip()
    if not c:
        return "empty command"
    for p in owner_denylist():
        if p.search(c):
            return "owner deny list"
    for p in _ADVERSARIAL:
        if p.search(c):
            return "adversarial pattern"
    words = {seg.strip().split()[0] for seg in re.split(r"[|;&]+", c) if seg.strip()}
    bad = words & _refused_words()
    if bad:
        return f"refused command {sorted(bad)[0]!r}"
    if has_pii(c):
        return "credential or personal data in the command"
    return ""


# ---------------------------------------------------------------- the record
def _h(s: str) -> str:
    return hashlib.sha256((s or "").encode("utf-8")).hexdigest()[:16]


def user_id(raw: str) -> str:
    return "u_" + hashlib.sha256((SALT + "|" + (raw or "anon")).encode()).hexdigest()[:12]


def intent_key(task: str) -> str:
    """The task's template: lower case, arguments (file names, numbers) as slots, filler words dropped. Same intent -> same key across users."""
    try:
        import augment as AUG
        t, _, _ = AUG.delex(task)
    except Exception:
        t = task
    t = re.sub(r"\s+", " ", re.sub(r"[^\w@\u0600-\u06FF ]", " ", t.lower())).strip()
    t = re.sub(r"\b(?:please|now|can you|for me|quickly)\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


FAMILIES = {          # task clusters by what the command does (the router's classes; one LoRA adapter per family)
    "inspect": {"ls", "pwd", "cat", "head", "tail", "date", "stat", "basename", "dirname"},
    "count": {"wc", "seq"},
    "search_sort": {"grep", "sort", "uniq", "cut", "tr"},
    "write": {"echo", "touch", "mkdir", "cp", "mv", "python3"},
}


def family(command: str) -> str:
    segs = [s.strip().split()[0] for s in (command or "").split("|") if s.strip()]
    if not segs:
        return "other"
    if segs[-1] == "wc" or segs[0] == "seq" or "sum(" in command:
        return "count"
    for fam, names in FAMILIES.items():
        if segs[0] in names:
            return fam
    return "other"


def make_record(user: str, task: str, command: str, exit_code: int, stdout: str = "", stderr: str = "", verdict=None, latency_s: float = 0.0,
                model: str = "sham2-tldm", adapter: str = "base", source: str = "user", names: tuple = (), ts: float | None = None, meta: dict | None = None) -> dict:
    intent, cmd = scrub(task, names), scrub(command, names)
    rec = {"v": SCHEMA_VERSION, "ts_day": time.strftime("%Y-%m-%d", time.gmtime(ts or time.time())), "user": user_id(user), "source": source,
           "intent": intent, "intent_key": intent_key(intent), "command": cmd, "exit_code": int(exit_code), "stdout_sha": _h(stdout), "stderr_sha": _h(stderr),
           "verdict": verdict, "latency_s": round(float(latency_s), 4), "model": model, "adapter": adapter, "family": family(cmd)}
    if meta:
        rec["meta"] = {k: v for k, v in meta.items() if k in ("license", "url", "seed", "query", "variant_of")}
    rec["rid"] = _h(json.dumps([rec["user"], rec["intent_key"], rec["command"], rec["stdout_sha"], rec["verdict"], (meta or {}).get("seed")]))
    return rec


class ExperienceLog:
    """Append-only JSONL of records (one file per day) + an in-memory index. Deleting the folder forgets everything; no weights are touched here."""

    def __init__(self, root: str | None = None, per_user_per_day: int = 500, max_share: float = 0.2):
        self.root, self.per_user_per_day, self.max_share = root, per_user_per_day, max_share
        self.records: list = []
        self._rids: set = set()
        self._day_count: dict = defaultdict(int)
        self.stats: dict = defaultdict(int)
        if root:
            os.makedirs(root, exist_ok=True)
            for f in sorted(os.listdir(root)):
                if f.endswith(".jsonl"):
                    for line in open(os.path.join(root, f), encoding="utf-8"):
                        try:
                            self._index(json.loads(line))
                        except ValueError:
                            continue

    def _index(self, rec: dict) -> None:
        self.records.append(rec)
        self._rids.add(rec["rid"])
        self._day_count[(rec["user"], rec["ts_day"])] += 1

    def add(self, rec: dict) -> str:
        if rec.get("v") != SCHEMA_VERSION:
            return self._count("rejected:schema")
        if rec["rid"] in self._rids:
            return self._count("duplicate")
        if self._day_count[(rec["user"], rec["ts_day"])] >= self.per_user_per_day:
            return self._count("rate_limited")
        self._index(rec)
        if self.root:
            with open(os.path.join(self.root, rec["ts_day"] + ".jsonl"), "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return self._count("added")

    def _count(self, what: str) -> str:
        self.stats[what] += 1
        return what

    def admitted(self, min_consensus: int = 2, sources: tuple = ("user", "curriculum", "web", "mesh"), return_reasons: bool = False, web_consensus: int = 1):
        """-> [(intent, command, family)] that may enter TRAINING. Consensus counts DISTINCT voters: users (source user), sampling seeds (curriculum),
        pages (web: the page is only the claim; the sandbox run is the check, so one page is enough by default), and publishing peers (mesh: a lesson
        another node ran successfully and THIS node re-ran successfully in its own sandbox; voter = the publisher, ai-system/terminal/mesh_net.py)."""
        why = defaultdict(int)
        groups: dict = defaultdict(lambda: {"voters": set(), "intents": [], "users": set(), "web": False})
        for r in self.records:
            if r.get("source") not in sources:
                continue
            if r.get("verdict") is not True or r.get("exit_code") != 0:
                why["not_verified"] += 1
                continue
            d = deny_reason(r["command"])
            if d:
                why["denied:" + d] += 1
                continue
            if re.search(r"<(?:email|token|secret|card|phone)>", r["intent"]) or has_pii(r["intent"]):
                why["pii_in_intent"] += 1
                continue
            g = groups[(r["intent_key"], r["command"])]
            src = r.get("source")
            meta = r.get("meta", {})
            g["voters"].add("web:" + meta.get("url", "") if src == "web" else r["user"] + ("#" + str(meta.get("seed")) if src == "curriculum" else ""))
            if src == "user":
                g["users"].add(r["user"])
            g["web"] |= src == "web"
            g["intents"].append((r["intent"], r["family"]))
        cands = []
        for (key, cmd), g in sorted(groups.items()):
            need = web_consensus if g["web"] else min_consensus
            if len(g["voters"]) < need:
                why["no_consensus"] += 1
                continue
            for intent, fam in dict.fromkeys(g["intents"]):
                cands.append((intent, cmd, fam, g["users"]))
        n_users = len({u for *_, us in cands for u in us})
        cap = max(1, int(self.max_share * len(cands))) if n_users >= 5 else len(cands)
        per_user, res = defaultdict(int), []
        for intent, cmd, fam, users in cands:
            if users and all(per_user[u] >= cap for u in users):      # a pair only real users vouch for, all of whom already filled their share
                why["user_share_cap"] += 1
                continue
            for u in users:
                per_user[u] += 1
            res.append((intent, cmd, fam))
        why["admitted"] = len(res)
        return (res, dict(why)) if return_reasons else res
