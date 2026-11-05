"""Per-user/model file-backed computer banks.

A bank is a logical namespace on the existing persistent computer volume, not a
new hosted database. Each session owns its own SQLite catalog and object files
under its already isolated home directory. There is no fixed bank-count limit;
physical free space and the computer's existing per-session disk quota remain
the actual limits.
"""
from __future__ import annotations

import hashlib
import mimetypes
import os
import re
import shutil
import sqlite3
import uuid
from pathlib import Path
from typing import Callable

DEFAULT_BANKS = {
    "projects": "Project source, checkouts, builds and project notes",
    "documents": "Text documents, PDFs and office files",
    "datasets": "CSV, JSON, tables and data-analysis inputs",
    "assets": "Images, audio, video and other binary assets",
    "sessions": "Reusable session notes, decisions and checkpoints",
    "tools": "Tool manifests, usage notes and reusable workflows",
}
BANK_RE = re.compile(r"^[a-z][a-z0-9_-]{0,47}$")
TEXT_SUFFIXES = {
    ".txt", ".md", ".rst", ".csv", ".tsv", ".json", ".jsonl", ".yaml",
    ".yml", ".toml", ".ini", ".cfg", ".log", ".py", ".js", ".jsx",
    ".ts", ".tsx", ".html", ".css", ".xml", ".sql", ".sh", ".env.example",
}
MAX_TEXT_BYTES = 1_000_000
MAX_INDEX_BYTES = 2_000_000
MAX_SEARCH_ROWS = 2500


def _safe_bank(value: object) -> str:
    name = str(value or "").strip().lower()
    if not BANK_RE.fullmatch(name):
        raise ValueError("bank name must start with a letter and contain only a-z, 0-9, _ or - (max 48 characters)")
    return name


def _safe_key(value: object) -> str:
    key = str(value or "").strip()
    if not key or len(key) > 180 or "\x00" in key or key in {".", ".."}:
        raise ValueError("entry key is required (1-180 characters)")
    return key


def _root(home: Path) -> Path:
    return home / "banks"


def _secure(path: Path, uid: int | None, directory: bool = False) -> None:
    try:
        os.chmod(path, 0o700 if directory else 0o600)
        if uid is not None and hasattr(os, "geteuid") and os.geteuid() == 0:
            os.chown(path, uid, uid, follow_symlinks=False)
    except OSError:
        # The app remains usable on non-root runners and hosts without chown.
        pass


def _connect(home: Path, uid: int | None) -> sqlite3.Connection:
    root = _root(home)
    root.mkdir(parents=True, exist_ok=True)
    _secure(root, uid, True)
    db_path = root / "catalog.sqlite3"
    db = sqlite3.connect(str(db_path), timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=FULL")
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS banks (
          name TEXT PRIMARY KEY,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS entries (
          bank TEXT NOT NULL REFERENCES banks(name) ON DELETE CASCADE,
          entry_key TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL CHECK(kind IN ('text','file')),
          content TEXT NOT NULL DEFAULT '',
          stored_path TEXT NOT NULL DEFAULT '',
          mime_type TEXT NOT NULL DEFAULT '',
          sha256 TEXT NOT NULL DEFAULT '',
          bytes INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(bank, entry_key)
        );
        CREATE INDEX IF NOT EXISTS bank_entries_updated ON entries(bank, updated_at DESC);
        CREATE TABLE IF NOT EXISTS links (
          source_bank TEXT NOT NULL,
          source_key TEXT NOT NULL,
          target_bank TEXT NOT NULL,
          target_key TEXT NOT NULL,
          relation TEXT NOT NULL DEFAULT 'related',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(source_bank, source_key, target_bank, target_key, relation),
          FOREIGN KEY(source_bank, source_key) REFERENCES entries(bank, entry_key) ON DELETE CASCADE,
          FOREIGN KEY(target_bank, target_key) REFERENCES entries(bank, entry_key) ON DELETE CASCADE
        );
        """
    )
    with db:
        db.executemany(
            "INSERT OR IGNORE INTO banks(name, description) VALUES (?, ?)",
            list(DEFAULT_BANKS.items()),
        )
    _secure(db_path, uid)
    return db


def _terms(text: str) -> set[str]:
    return {
        word.casefold()
        for word in re.findall(r"[\w\u0600-\u06ff.-]{2,}", str(text or ""), flags=re.UNICODE)
    }


def _entry_row(row: sqlite3.Row) -> dict:
    return {
        "bank": row["bank"],
        "key": row["entry_key"],
        "title": row["title"],
        "description": row["description"],
        "kind": row["kind"],
        "path": row["stored_path"] or None,
        "mime_type": row["mime_type"] or None,
        "bytes": int(row["bytes"] or 0),
        "sha256": row["sha256"],
        "updated_at": row["updated_at"],
    }


def _ensure_bank(db: sqlite3.Connection, name: str) -> bool:
    return db.execute("SELECT 1 FROM banks WHERE name=?", (name,)).fetchone() is not None


def run_bank_action(
    session: str,
    job: dict,
    *,
    home: Path,
    safe_path: Callable[[str], Path],
    over_quota: Callable[[], bool],
    uid: int | None = None,
) -> dict:
    """Run one catalog operation inside the caller-supplied, session-private home."""
    action = str(job.get("bank_action") or job.get("operation") or "").strip().lower()
    if action not in {"list", "create", "put", "import", "read", "search", "link", "links", "stats"}:
        return {"ok": False, "error": "bank_action must be list, create, put, import, read, search, link, links or stats"}
    try:
        db = _connect(home, uid)
    except (OSError, sqlite3.Error) as exc:
        return {"ok": False, "error": f"could not open this session's bank catalog: {type(exc).__name__}: {str(exc)[:180]}"}
    try:
        if action == "list":
            rows = db.execute(
                "SELECT b.name,b.description,b.created_at,b.updated_at,COUNT(e.entry_key) AS entries,"
                "COALESCE(SUM(e.bytes),0) AS bytes FROM banks b LEFT JOIN entries e ON e.bank=b.name "
                "GROUP BY b.name ORDER BY b.name"
            ).fetchall()
            return {"ok": True, "banks": [dict(r) for r in rows], "bank_count": len(rows),
                    "store": "private persistent workspace; user:model isolated"}

        if action == "create":
            name = _safe_bank(job.get("bank"))
            description = str(job.get("description") or "").strip()[:500]
            with db:
                db.execute(
                    "INSERT INTO banks(name,description) VALUES(?,?) "
                    "ON CONFLICT(name) DO UPDATE SET description=CASE WHEN excluded.description='' THEN banks.description ELSE excluded.description END,updated_at=CURRENT_TIMESTAMP",
                    (name, description),
                )
            bank_path = _root(home) / name
            bank_path.mkdir(parents=True, exist_ok=True)
            _secure(bank_path, uid, True)
            return {"ok": True, "created": name, "description": description}

        name = _safe_bank(job.get("bank"))
        if not _ensure_bank(db, name):
            return {"ok": False, "error": f"bank '{name}' does not exist; create it first or call list"}
        bank_dir = _root(home) / name
        bank_dir.mkdir(parents=True, exist_ok=True)
        _secure(bank_dir, uid, True)

        if action == "put":
            key = _safe_key(job.get("key"))
            content = str(job.get("content") or "")
            size = len(content.encode("utf-8"))
            if size > MAX_TEXT_BYTES:
                return {"ok": False, "error": "a bank text entry is limited to 1 MB; split it into smaller keyed entries"}
            if over_quota():
                return {"ok": False, "error": "this session has reached its existing computer disk quota"}
            title = str(job.get("title") or key)[:240]
            description = str(job.get("description") or "")[:1000]
            digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
            with db:
                db.execute(
                    "INSERT INTO entries(bank,entry_key,title,description,kind,content,sha256,bytes) VALUES(?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(bank,entry_key) DO UPDATE SET title=excluded.title,description=excluded.description,kind='text',content=excluded.content,stored_path='',mime_type='',sha256=excluded.sha256,bytes=excluded.bytes,updated_at=CURRENT_TIMESTAMP",
                    (name, key, title, description, "text", content, digest, size),
                )
            _secure(_root(home) / "catalog.sqlite3", uid)
            return {"ok": True, "bank": name, "key": key, "bytes": size, "sha256": digest}

        if action == "import":
            key = _safe_key(job.get("key") or job.get("title") or job.get("source_path"))
            try:
                source = safe_path(str(job.get("source_path") or ""))
            except ValueError as exc:
                return {"ok": False, "error": str(exc)}
            if source.is_symlink() or not source.is_file():
                return {"ok": False, "error": "source_path must be a regular file inside this session's computer home"}
            size = source.stat().st_size
            if size > 512 * 1024 * 1024:
                return {"ok": False, "error": "one imported file is limited to 512 MB"}
            if over_quota():
                return {"ok": False, "error": "this session has reached its existing computer disk quota"}
            original = str(job.get("file_name") or source.name)
            filename = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(original).name).strip("._")[:100] or "file"
            object_dir = bank_dir / "files"
            object_dir.mkdir(parents=True, exist_ok=True)
            object_name = uuid.uuid4().hex[:16] + "_" + filename
            target = object_dir / object_name
            temporary = object_dir / (object_name + ".tmp")
            shutil.copyfile(source, temporary)
            os.replace(temporary, target)
            _secure(object_dir, uid, True)
            _secure(target, uid)
            digest = hashlib.sha256()
            with target.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
            suffix = target.suffix.lower()
            mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            searchable = ""
            if suffix in TEXT_SUFFIXES and size <= MAX_INDEX_BYTES:
                searchable = target.read_text(encoding="utf-8", errors="replace")
            relative = str(target.relative_to(home))
            title = str(job.get("title") or filename)[:240]
            description = str(job.get("description") or "")[:1000]
            with db:
                db.execute(
                    "INSERT INTO entries(bank,entry_key,title,description,kind,content,stored_path,mime_type,sha256,bytes) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(bank,entry_key) DO UPDATE SET title=excluded.title,description=excluded.description,kind='file',content=excluded.content,stored_path=excluded.stored_path,mime_type=excluded.mime_type,sha256=excluded.sha256,bytes=excluded.bytes,updated_at=CURRENT_TIMESTAMP",
                    (name, key, title, description, "file", searchable, relative, mime, digest.hexdigest(), size),
                )
            _secure(_root(home) / "catalog.sqlite3", uid)
            return {"ok": True, "bank": name, "key": key, "path": relative, "mime_type": mime, "bytes": size,
                    "indexed_text": bool(searchable), "sha256": digest.hexdigest()}

        if action == "read":
            key = _safe_key(job.get("key"))
            row = db.execute("SELECT * FROM entries WHERE bank=? AND entry_key=?", (name, key)).fetchone()
            if row is None:
                return {"ok": False, "error": f"entry '{key}' was not found in bank '{name}'"}
            result = _entry_row(row)
            if row["kind"] == "text":
                result["content"] = row["content"]
            elif row["content"]:
                result["text_excerpt"] = row["content"][:12000]
            return {"ok": True, "entry": result}

        if action == "search":
            query = str(job.get("query") or "").strip()
            terms = _terms(query)
            if not terms:
                return {"ok": False, "error": "search query must contain at least one word"}
            bank_filter = str(job.get("bank") or "").strip().lower()
            if bank_filter and not _ensure_bank(db, bank_filter):
                return {"ok": False, "error": f"bank '{bank_filter}' does not exist"}
            sql = "SELECT * FROM entries" + (" WHERE bank=?" if bank_filter else "") + " ORDER BY updated_at DESC LIMIT ?"
            params = (bank_filter, MAX_SEARCH_ROWS) if bank_filter else (MAX_SEARCH_ROWS,)
            rows = db.execute(sql, params).fetchall()
            ranked = []
            for row in rows:
                text = " ".join((row["entry_key"], row["title"], row["description"], row["content"]))
                words = _terms(text)
                overlap = terms & words
                if not overlap:
                    continue
                score = sum(1.0 + min(4, text.casefold().count(term)) * 0.15 for term in overlap)
                if query.casefold() in text.casefold():
                    score += 2.0
                ranked.append((score, row))
            ranked.sort(key=lambda x: (x[0], x[1]["updated_at"]), reverse=True)
            limit = max(1, min(20, int(job.get("limit") or 8)))
            hits = []
            for score, row in ranked[:limit]:
                result = _entry_row(row)
                excerpt = row["content"].replace("\n", " ")[:420]
                result["excerpt"] = excerpt or row["description"][:420]
                result["score"] = round(score, 3)
                hits.append(result)
            return {"ok": True, "query": query[:200], "hits": hits, "matched": len(ranked),
                    "ranking": "local lexical index; no model weights or hosted database required"}

        if action == "link":
            source_key = _safe_key(job.get("key"))
            target_bank = _safe_bank(job.get("target_bank"))
            target_key = _safe_key(job.get("target_key"))
            relation = str(job.get("relation") or "related").strip()[:80] or "related"
            if not _ensure_bank(db, target_bank):
                return {"ok": False, "error": f"target bank '{target_bank}' does not exist"}
            exists = db.execute(
                "SELECT 1 FROM entries WHERE bank=? AND entry_key=?",
                (name, source_key),
            ).fetchone()
            target_exists = db.execute(
                "SELECT 1 FROM entries WHERE bank=? AND entry_key=?",
                (target_bank, target_key),
            ).fetchone()
            if not exists or not target_exists:
                return {"ok": False, "error": "both source and target entries must exist before linking"}
            with db:
                db.execute(
                    "INSERT OR IGNORE INTO links(source_bank,source_key,target_bank,target_key,relation) VALUES(?,?,?,?,?)",
                    (name, source_key, target_bank, target_key, relation),
                )
            return {"ok": True, "source": {"bank": name, "key": source_key},
                    "target": {"bank": target_bank, "key": target_key}, "relation": relation}

        if action == "links":
            key = _safe_key(job.get("key"))
            rows = db.execute(
                "SELECT source_bank,source_key,target_bank,target_key,relation FROM links "
                "WHERE (source_bank=? AND source_key=?) OR (target_bank=? AND target_key=?) "
                "ORDER BY created_at DESC LIMIT 100",
                (name, key, name, key),
            ).fetchall()
            return {"ok": True, "links": [dict(r) for r in rows]}

        if action == "stats":
            row = db.execute("SELECT COUNT(*) AS entries,COALESCE(SUM(bytes),0) AS bytes FROM entries WHERE bank=?", (name,)).fetchone()
            links = db.execute("SELECT COUNT(*) FROM links WHERE source_bank=? OR target_bank=?", (name, name)).fetchone()[0]
            return {"ok": True, "bank": name, "entries": int(row["entries"]), "bytes": int(row["bytes"]),
                    "links": int(links), "logical_size_limit": None, "physical_storage_remains_bounded": True}
        return {"ok": False, "error": "unsupported bank action"}
    except (ValueError, OSError, sqlite3.Error, shutil.Error) as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:220]}"}
    finally:
        db.close()
