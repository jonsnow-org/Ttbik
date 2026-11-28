"""Qalam's tool system: ONE typed registry (GitHub, a persistent computer, throw-away sandbox, web, media, memory, schedules, connectors, planning),
loaded lazily by group (the model sees only the core group until it asks for another: a short context, fast reads), one native token id per tool,
risk tiers with approvals, batching and background jobs. Nothing here executes anything: it validates, classifies and describes; the caller's
executor (an isolated sandbox) does the work."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from .config import ModelConfig

# risk: read (no side effects) | exec (runs inside the sandbox) | write (changes something that can be undone) | external (talks to the outside world)
#       destructive (hard to undo: asks for a typed confirmation too) | secret (a person types it; the model never sees the value)
RISKS = ("read", "exec", "write", "external", "destructive", "secret")
MAX_STR = 20000
MAX_BATCH = 8


@dataclass(frozen=True)
class Arg:
    name: str
    kind: str                       # str path url int float bool list json enum
    required: bool = True
    default: object = None
    choices: tuple[str, ...] = ()


@dataclass(frozen=True)
class ToolSpec:
    name: str
    group: str
    risk: str
    args: tuple[Arg, ...] = field(default_factory=tuple)
    doc: str = ""
    batchable: bool = False


def _args(spec: str) -> tuple[Arg, ...]:
    """'path:path, ref?:str, state?:enum(open|closed)=open, limit?:int=50' -> typed Args."""
    out = []
    for part in [p.strip() for p in spec.split(",") if p.strip()]:
        name, _, rest = part.partition(":")
        default = None
        if "=" in rest:
            rest, _, default = rest.partition("=")
        optional = name.endswith("?")
        name = name.rstrip("?")
        choices: tuple[str, ...] = ()
        m = re.fullmatch(r"enum\((.+)\)", rest)
        if m:
            kind, choices = "enum", tuple(m.group(1).split("|"))
        else:
            kind = rest
        if kind not in ("str", "path", "url", "int", "float", "bool", "list", "json", "enum"):
            raise ValueError(f"bad argument kind {kind!r} in {spec!r}")
        out.append(Arg(name, kind, not optional, {"int": int, "float": float}.get(kind, str)(default) if default not in (None, "") and kind in ("int", "float") else default, choices))
    return tuple(out)


def _t(group: str, risk: str, names: str, args: str = "", doc: str = "", batchable: bool = False) -> list[ToolSpec]:
    return [ToolSpec(n, group, risk, _args(args), doc, batchable) for n in names.split()]


_ALL: list[ToolSpec] = []
# ------------------------------------------------------------------ core: always visible (planning, asking, loading, thinking)
_ALL += _t("core", "read", "load_tools", "group:str", "make a tool group visible: github computer worker web media memory schedule connectors")
_ALL += _t("core", "read", "plan", "steps:list", "write or update the step list of the task")
_ALL += _t("core", "read", "ask_user", "question:str, options?:list", "ask the person a short question")
_ALL += _t("core", "read", "think", "budget?:int=256", "private reasoning inside the token budget; never executed, never the answer")
_ALL += _t("core", "read", "skill", "name:str", "load a saved procedure")
_ALL += _t("core", "secret", "request_secret", "name:str, reason:str", "ask the person to type a key; the model receives only a handle")
_ALL += _t("core", "write", "delegate", "task:str, tools?:list, budget?:int=8", "a sub-agent with its own step budget and a NARROWER tool set; returns its summary")
# ------------------------------------------------------------------ computer: the persistent terminal and files
_ALL += _t("computer", "exec", "computer_run", "command:str, cwd?:path, timeout?:int=90", "one command line (allowlisted programs only)", True)
_ALL += _t("computer", "read", "computer_read", "path:path, start?:int=1, lines?:int=200", "read a file window", True)
_ALL += _t("computer", "read", "computer_search", "pattern:str, path?:path, glob?:str", "ripgrep over files", True)
_ALL += _t("computer", "write", "computer_write", "path:path, content:str", "create or replace a file", True)
_ALL += _t("computer", "write", "computer_edit", "path:path, old:str, new:str", "exact single replacement", True)
_ALL += _t("computer", "write", "computer_patch", "diff:str, cwd?:path", "apply a unified diff", True)
_ALL += _t("computer", "exec", "computer_test", "command?:str, cwd?:path", "run the project's tests", True)
_ALL += _t("computer", "exec", "computer_job", "action:enum(start|log|stop|list), command?:str, id?:str, tail?:int=80", "a background job for anything over 90 s")
_ALL += _t("computer", "read", "computer_tools", "", "which programs the computer has")
_ALL += _t("computer", "read", "computer_apps", "", "installed workstation apps")
_ALL += _t("computer", "write", "computer_bank", "action:enum(create|store|search|restore|list), name?:str, path?:path, query?:str", "private file banks")
_ALL += _t("computer", "external", "computer_repo", "url:url, ref?:str", "fetch a repository onto the computer (public or the owner's private one, by signed address)")
_ALL += _t("computer", "external", "computer_publish", "branch:str, message:str", "ONE commit of all changes of a computer_repo checkout")
_ALL += _t("computer", "exec", "computer_batch", "steps:list", "up to 8 steps in one call, stops at the first error")
_ALL += _t("computer", "exec", "browser", "action:enum(open|click|type|read|screenshot|download|close), url?:str, selector?:str, text?:str", "an isolated headless browser")
_ALL += _t("computer", "exec", "desktop", "action:enum(screenshot|click|type|key|scroll), x?:int, y?:int, text?:str", "the graphical desktop of the computer")
# ------------------------------------------------------------------ worker: a throw-away build/test workspace
_ALL += _t("worker", "exec", "sandbox_clone", "url:url, ref?:str", "clone into a temporary workspace")
_ALL += _t("worker", "exec", "sandbox_exec", "command:str, timeout?:int=90", "run a command in the temporary workspace")
_ALL += _t("worker", "read", "sandbox_wait", "id:str, tail?:int=80", "wait for / read a running command")
_ALL += _t("worker", "read", "sandbox_read_file sandbox_search", "path?:path, pattern?:str", "read or search the temporary workspace")
_ALL += _t("worker", "write", "sandbox_write_file sandbox_edit_file", "path:path, content?:str, old?:str, new?:str", "change a file in the temporary workspace")
_ALL += _t("worker", "external", "sandbox_push", "branch:str, message:str", "push the temporary workspace's changes")
# ------------------------------------------------------------------ github
_gh_read = ("github_whoami github_list_repos github_repo_info github_repo_scan github_repo_audit github_read_files github_list_files github_read_file "
            "github_search_code github_search_repos github_list_branches github_list_prs github_list_issues github_ci_status github_ci_logs github_pr_info "
            "github_commits github_compare")
_ALL += _t("github", "read", _gh_read, "repo?:str, path?:str, query?:str, ref?:str, number?:int, state?:enum(open|closed|all)=open, limit?:int=50")
_ALL += _t("github", "write", "github_create_branch github_write_files github_edit_file github_create_pr github_create_issue github_comment github_run_workflow github_update_ref",
           "repo:str, branch?:str, path?:str, content?:str, title?:str, body?:str, number?:int, files?:json, workflow?:str, ref?:str")
_ALL += _t("github", "destructive", "github_merge_pr github_delete_files github_delete_branch github_delete_release github_delete_repo github_update_repo "
           "github_add_collaborator github_remove_collaborator github_create_release", "repo:str, number?:int, branch?:str, path?:str, tag?:str, user?:str, settings?:json")
_ALL += _t("github", "external", "github_api", "method:enum(GET|POST|PUT|PATCH|DELETE), path:str, body?:json", "any GitHub REST call (POST/PUT/PATCH/DELETE need approval)")
# ------------------------------------------------------------------ web
_ALL += _t("web", "read", "web_search deep_research", "query:str, limit?:int=8", "search the web / a multi-step research")
_ALL += _t("web", "read", "fetch_page web_fetch", "url:url, max_chars?:int=8000", "read one page as text")
_ALL += _t("web", "external", "http_request", "method:enum(GET|POST|PUT|PATCH|DELETE), url:url, body?:json, headers?:json", "any HTTP request (GET is read; the rest need approval)")
# ------------------------------------------------------------------ media: reading AND native generation of any size / length
_ALL += _t("media", "read", "view_image view_video listen_audio", "path:path, frame?:int, start?:float, seconds?:float", "perceive a file (own codecs, not an outside model)")
_ALL += _t("media", "exec", "generate_image", "prompt:str, rows?:int=32, columns?:int=32, steps?:int=8, seed?:int", "an image of any size (code grid), parallel T-LDM writing")
_ALL += _t("media", "exec", "generate_video", "prompt:str, frames?:int=16, rows?:int=16, columns?:int=16, fps?:int=12, continue_from?:str", "a video of any length (continues in windows)")
_ALL += _t("media", "exec", "generate_audio", "prompt:str, seconds?:float=5.0, kind?:enum(speech|music|sound)=speech, voice?:str", "audio of any duration")
_ALL += _t("media", "exec", "edit_image", "path:path, prompt:str, region?:json", "edit part of an image")
_ALL += _t("media", "write", "send_file", "path:path, caption?:str", "deliver a file to the person")
# ------------------------------------------------------------------ memory and knowledge
_ALL += _t("memory", "read", "recall memory_search knowledge_search", "query:str, limit?:int=8")
_ALL += _t("memory", "write", "memory_note memory_save", "text:str, tags?:list")
_ALL += _t("memory", "destructive", "memory_forget", "id:str")
# ------------------------------------------------------------------ schedules and connectors
_ALL += _t("schedule", "read", "schedule_list", "")
_ALL += _t("schedule", "write", "schedule_create", "when:str, task:str, repeat?:str")
_ALL += _t("schedule", "destructive", "schedule_delete", "id:str")
_ALL += _t("connectors", "read", "mcp_list_tools", "server:str")
_ALL += _t("connectors", "external", "mcp_call connector_api", "server:str, tool:str, arguments?:json, method?:str, path?:str", "a connected service")

# ------------------------------------------------------------------ files: create / read / edit / convert documents, sheets, slides, PDFs, images, audio, video, archives, data
# These only touch the workspace (confined by fileops.Workspace), so they are `exec`: no click needed; delivering a file out of the workspace is `send_file` (write).
_ALL += _t("files", "read", "file_info av_info image_info archive_list", "path:path")
_ALL += _t("files", "read", "file_read", "path:path, start?:int=1, lines?:int=200")
_ALL += _t("files", "exec", "file_write", "path:path, content:str", "any text-based format: txt md json yaml csv tsv html xml css js py sql ...")
_ALL += _t("files", "exec", "file_edit", "path:path, old:str, new:str", "exact single replacement in a text file")
_ALL += _t("files", "exec", "doc_create", "path:path, blocks:list", "Word .docx from blocks: heading paragraph list table image page_break")
_ALL += _t("files", "read", "doc_read sheet_read slides_read pdf_read", "path:path, sheet?:str, range?:str, pages?:str")
_ALL += _t("files", "exec", "doc_edit sheet_edit slides_edit", "path:path, ops:list", "edit an existing .docx / .xlsx / .pptx in place")
_ALL += _t("files", "exec", "sheet_create", "path:path, sheets:json", "Excel .xlsx: {sheet name: [[row], ...]}, formulas start with =")
_ALL += _t("files", "exec", "slides_create", "path:path, slides:list", "PowerPoint .pptx: [{title, bullets?, image?, notes?}]")
_ALL += _t("files", "exec", "pdf_create", "path:path, blocks:list", "PDF from blocks")
_ALL += _t("files", "exec", "pdf_edit image_edit", "path:path, ops:list, out?:path", "PDF extract/delete/rotate/merge pages; image resize/crop/rotate/filter/text")
_ALL += _t("files", "exec", "av_edit", "path:path, ops:list, out:path", "audio / video: trim scale extract_audio speed volume mute to_gif")
_ALL += _t("files", "exec", "file_convert", "path:path, to:str", "between documents (md html docx odt rtf epub txt tex), office to pdf/csv, images, audio, video")
_ALL += _t("files", "exec", "archive_create", "paths:list, out:path, format?:enum(zip|tar|tar.gz)=zip")
_ALL += _t("files", "exec", "archive_extract", "path:path, to?:path", "zip / tar with zip-slip and bomb guards")
_ALL += _t("files", "exec", "data_transform", "path:path, op:enum(to_json|to_csv|to_yaml|query|set), expr?:str, out?:path", "csv / tsv / json / yaml conversion, dotted-path query and set")
# ------------------------------------------------------------------ dev: make software (any language), build, package, preview, ship
_ALL += _t("dev", "exec", "project_scaffold", "kind:enum(python|node|web|static|cli|api|library|android|bot), name:str, path?:path")
_ALL += _t("dev", "exec", "install_packages", "manager:enum(pip|npm|apt|cargo|go), packages:list", "installs software INSIDE its sandbox (owner decision 2026-11-23: no approval; logged)")
_ALL += _t("dev", "exec", "build lint format run_tests", "command?:str, cwd?:path", "the project's own build / lint / format / test commands (allowlisted programs only)")
_ALL += _t("dev", "exec", "serve_preview", "cwd?:path, port?:int=8000, command?:str", "a local preview server, never exposed publicly by the model")
_ALL += _t("dev", "exec", "package_release", "path:path, format?:enum(zip|tar.gz|apk|wheel|docker)=zip")
_ALL += _t("dev", "destructive", "deploy", "target:str, path:path", "publish to a host: approval and a typed confirmation")
# ------------------------------------------------------------------ web extras: the wider internet
_ALL += _t("web", "external", "download_file upload_file", "url:url, path:path", "move a file between the workspace and the internet (approval)")
_ALL += _t("web", "read", "rss_read", "url:url, limit?:int=20")
_ALL += _t("web", "exec", "screenshot_url", "url:url, width?:int=1280, height?:int=800, path?:path")
_ALL += _t("web", "external", "send_email", "to:str, subject:str, body:str, attachments?:list", "a message to a real person: approval every time")
_ALL += _t("web", "external", "form_submit", "url:url, fields:json", "submit a web form (approval)")

REGISTRY: dict[str, ToolSpec] = {}
for _s in _ALL:
    if _s.name in REGISTRY:
        raise RuntimeError(f"duplicate tool {_s.name}")
    REGISTRY[_s.name] = _s
ORDER: list[str] = list(REGISTRY)                       # the order fixes each tool's token id: append only, never reorder
GROUPS = sorted({s.group for s in REGISTRY.values()})
CORE_GROUP = "core"


def tool_id(cfg: ModelConfig, name: str) -> int:
    if len(ORDER) > cfg.tool_codes:
        raise ValueError("more tools than tool_codes")
    return cfg.tool_base + ORDER.index(name)


def tool_name(cfg: ModelConfig, token: int) -> str | None:
    i = token - cfg.tool_base
    return ORDER[i] if 0 <= i < len(ORDER) else None


def visible_tools(loaded: set[str] | frozenset[str] = frozenset()) -> list[str]:
    """What the model is shown: the core group, plus every group it has loaded with `load_tools`."""
    return [n for n, s in REGISTRY.items() if s.group == CORE_GROUP or s.group in loaded]


# Tools that share a wide argument spec still have their own mandatory arguments.
REQUIRED: dict[str, tuple[str, ...]] = {
    "github_read_file": ("repo", "path"), "github_read_files": ("repo",), "github_list_files": ("repo",), "github_repo_info": ("repo",),
    "github_repo_scan": ("repo",), "github_repo_audit": ("repo",), "github_search_code": ("query",), "github_search_repos": ("query",),
    "github_list_branches": ("repo",), "github_list_prs": ("repo",), "github_list_issues": ("repo",), "github_pr_info": ("repo", "number"),
    "github_ci_status": ("repo",), "github_ci_logs": ("repo", "number"), "github_commits": ("repo",), "github_compare": ("repo", "ref"),
    "github_create_branch": ("repo", "branch"), "github_write_files": ("repo", "branch", "files"), "github_edit_file": ("repo", "branch", "path", "content"),
    "github_create_pr": ("repo", "branch", "title"), "github_create_issue": ("repo", "title"), "github_comment": ("repo", "number", "body"),
    "github_run_workflow": ("repo", "workflow"), "github_merge_pr": ("repo", "number"), "github_delete_branch": ("repo", "branch"),
    "github_delete_files": ("repo", "path"), "github_delete_repo": ("repo",), "github_update_repo": ("repo", "settings"),
    "github_add_collaborator": ("repo", "user"), "github_remove_collaborator": ("repo", "user"), "github_create_release": ("repo", "tag"),
    "github_delete_release": ("repo", "tag"), "github_update_ref": ("repo", "ref"),
    "sandbox_read_file": ("path",), "sandbox_search": ("pattern",), "sandbox_write_file": ("path", "content"), "sandbox_edit_file": ("path", "old", "new"),
    "web_search": ("query",), "deep_research": ("query",), "file_read": ("path",), "file_write": ("path", "content"), "file_edit": ("path", "old", "new"),
    "doc_create": ("path", "blocks"), "doc_edit": ("path", "ops"), "sheet_create": ("path", "sheets"), "sheet_edit": ("path", "ops"), "slides_create": ("path", "slides"),
    "slides_edit": ("path", "ops"), "pdf_create": ("path", "blocks"), "pdf_edit": ("path", "ops"), "image_edit": ("path", "ops"), "av_edit": ("path", "ops", "out"),
    "file_convert": ("path", "to"), "archive_create": ("paths", "out"), "data_transform": ("path", "op"), "project_scaffold": ("kind", "name"),
    "install_packages": ("manager", "packages"), "deploy": ("target", "path"), "download_file": ("url", "path"), "upload_file": ("url", "path"),
    "send_email": ("to", "subject", "body"), "form_submit": ("url", "fields"), "rss_read": ("url",), "screenshot_url": ("url",),
    "web_search": ("query",), "deep_research": ("query",), "recall": ("query",), "memory_search": ("query",), "knowledge_search": ("query",),
    "mcp_call": ("server", "tool"), "connector_api": ("server", "method", "path"), "view_image": ("path",), "view_video": ("path",), "listen_audio": ("path",),
}

_PRIVATE = re.compile(r"^(https?://)?(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?)", re.I)
_BAD_PATH = re.compile(r"(^/|^~|(^|/)\.\.(/|$)|\x00)")


@dataclass(frozen=True)
class Verdict:
    ok: bool
    reason: str = "ok"
    needs_approval: bool = False
    needs_confirmation: bool = False        # destructive: the person must type the target's name, not just press OK
    risk: str = "read"


def _check_arg(a: Arg, v: object) -> str | None:
    k = a.kind
    if k in ("str", "path", "url", "enum") and not isinstance(v, str):
        return f"{a.name} must be text"
    if isinstance(v, str) and len(v) > MAX_STR:
        return f"{a.name} is too long"
    if k == "path" and _BAD_PATH.search(v):
        return f"{a.name} leaves the workspace"
    if k == "url" and (not re.match(r"^https?://", v, re.I) or _PRIVATE.match(v)):
        return f"{a.name} is not a public http(s) address"
    if k == "enum" and v not in a.choices:
        return f"{a.name} must be one of {'|'.join(a.choices)}"
    if k == "int" and (isinstance(v, bool) or not isinstance(v, int) or abs(v) > 10**9):
        return f"{a.name} must be an integer"
    if k == "float" and (isinstance(v, bool) or not isinstance(v, (int, float))):
        return f"{a.name} must be a number"
    if k == "bool" and not isinstance(v, bool):
        return f"{a.name} must be true or false"
    if k == "list" and not isinstance(v, list):
        return f"{a.name} must be a list"
    return None


def validate(name: str, args: dict, loaded: set[str] | frozenset[str] = frozenset(), depth: int = 0) -> Verdict:
    """Is this call well-formed, visible, and what approval does it need? Never runs anything."""
    spec = REGISTRY.get(name)
    if spec is None:
        return Verdict(False, "unknown tool")
    if spec.group != CORE_GROUP and spec.group not in loaded:
        return Verdict(False, f"group {spec.group!r} is not loaded: call load_tools first", risk=spec.risk)
    if not isinstance(args, dict):
        return Verdict(False, "arguments must be an object", risk=spec.risk)
    known = {a.name: a for a in spec.args}
    extra = set(args) - set(known)
    if extra:
        return Verdict(False, f"unknown argument {sorted(extra)[0]!r}", risk=spec.risk)
    must = set(REQUIRED.get(name, ()))
    for a in spec.args:
        if a.name not in args:
            if a.required or a.name in must:
                return Verdict(False, f"missing argument {a.name!r}", risk=spec.risk)
            continue
        err = _check_arg(a, args[a.name])
        if err:
            return Verdict(False, err, risk=spec.risk)
    risk = spec.risk
    if name == "http_request" and args.get("method", "GET") == "GET":
        risk = "read"
    if name == "github_api" and args.get("method", "GET") == "GET":
        risk = "read"
    if name == "computer_job" and args.get("action") in ("log", "list", "stop"):
        risk = "read"
    if name == "computer_bank" and args.get("action") in ("search", "list"):
        risk = "read"
    needs_conf = risk == "destructive"
    needs_app = risk in ("write", "external", "destructive", "secret") or (risk == "exec" and name in ("generate_video",))
    if name == "computer_batch":
        steps = args.get("steps")
        if depth or not isinstance(steps, list) or not 1 <= len(steps) <= MAX_BATCH:
            return Verdict(False, f"a batch has 1 to {MAX_BATCH} steps and cannot nest", risk=risk)
        for st in steps:
            if not isinstance(st, dict) or not isinstance(st.get("tool"), str) or not isinstance(st.get("args", {}), dict):
                return Verdict(False, "each step is {tool, args}", risk=risk)
            sub = REGISTRY.get(st["tool"])
            if sub is None or not sub.batchable:
                return Verdict(False, f"step tool {st['tool']!r} cannot be batched", risk=risk)
            v = validate(st["tool"], st.get("args", {}), loaded, depth + 1)
            if not v.ok:
                return Verdict(False, f"step {st['tool']}: {v.reason}", risk=risk)
            needs_app |= v.needs_approval
            needs_conf |= v.needs_confirmation
    return Verdict(True, "ok", needs_app, needs_conf, risk)


def parse_call(text: str) -> tuple[str, dict] | None:
    """'name {json}' -> (name, args); None if it is not that shape."""
    m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\{.*\})?\s*$", text or "", re.S)
    if not m:
        return None
    try:
        return m.group(1), json.loads(m.group(2) or "{}")
    except json.JSONDecodeError:
        return None


def shape_result(text: str, limit: int = 2000) -> str:
    """Long tool output keeps its head and tail (the error is usually at the end), never an unbounded blob in the context."""
    if len(text) <= limit:
        return text
    cut = len(text) - limit
    return text[: limit // 2] + f"\n... [{cut} characters cut] ...\n" + text[-(limit // 2):]
