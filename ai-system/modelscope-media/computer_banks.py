"""Private, file-backed bank network for each user:model computer session.

No external database, service credential or paid storage is required. Each session
gets its own sharded, content-addressed object store and SQLite search catalog.
The number of banks/items is not hard-coded; actual disk capacity and the
computer session quota remain the physical limits.
"""
from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import time
import uuid
import zlib
from pathlib import Path
from typing import Callable

BANK_DIR = ".computer-banks"
MAX_CONTENT_BYTES = 2 * 1024 * 1024
MAX_OBJECT_BYTES = 512 * 1024 * 1024
MAX_INDEX_CHARS = 1_000_000
CHUNK_CHARS = 1800
MAX_RESULT = 20
TEXT_SUFFIXES = {
    ".txt", ".md", ".markdown", ".rst", ".csv", ".tsv", ".json", ".jsonl",
    ".xml", ".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx", ".py",
    ".ipynb", ".sql", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".log",
    ".sh", ".bash", ".c", ".h", ".cpp", ".java", ".go", ".rs", ".rb",
    ".php", ".tex", ".svg",
}
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
TOKEN_RE = re.compile(r"[\w\u0600-\u06FF]{2,}", re.UNICODE)
_LOCKS: dict[str, object] = {}


def _owner(path: Path, uid: int | None) -> None:
    if uid is None:
        return
    try:
        os.chown(path, uid, uid, follow_symlinks=False)
    except (OSError, TypeError):
        pass


def _root(home: Path, uid: int | None) -> Path:
    root = Path(home).resolve() / BANK_DIR
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(root, 0o700)
    _owner(root, uid)
    for name in ("objects", ".staging"):
        child = root / name
        child.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(child, 0o700)
        _owner(child, uid)
    return root


def _db(root: Path, uid: int | None) -> sqlite3.Connection:
    db = sqlite3.connect(str(root / "catalog.sqlite3"), timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS banks (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL DEFAULT 'general',
            description TEXT NOT NULL DEFAULT '',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            bank_id TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'file',
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            sha256 TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            compressed_bytes INTEGER NOT NULL,
            metadata TEXT NOT NULL DEFAULT '{}',
            text_chars INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL,
            UNIQUE(bank_id, name, sha256)
        );
        CREATE INDEX IF NOT EXISTS items_bank_created ON items(bank_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS items_sha ON items(sha256);
        CREATE TABLE IF NOT EXISTS chunks (
            item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            bank_id TEXT NOT NULL,
            chunk_no INTEGER NOT NULL,
            body TEXT NOT NULL,
            PRIMARY KEY(item_id, chunk_no)
        );
        CREATE INDEX IF NOT EXISTS chunks_bank ON chunks(bank_id);
        CREATE TABLE IF NOT EXISTS bank_links (
            from_bank TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
            to_bank TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
            relation TEXT NOT NULL DEFAULT 'related',
            note TEXT NOT NULL DEFAULT '',
            created_at REAL NOT NULL,
            PRIMARY KEY(from_bank, to_bank, relation)
        );
        CREATE INDEX IF NOT EXISTS bank_links_reverse ON bank_links(to_bank);
    """)
    try:
        db.execute("""CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts
                      USING fts5(item_id UNINDEXED, bank_id UNINDEXED, chunk_no UNINDEXED,
                                 body, tokenize='unicode61 remove_diacritics 2')""")
    except sqlite3.OperationalError:
        pass
    _owner(root / "catalog.sqlite3", uid)
    return db


def _finish_db(db: sqlite3.Connection, root: Path, uid: int | None) -> None:
    try:
        db.close()
    finally:
        for name in ("catalog.sqlite3", "catalog.sqlite3-wal", "catalog.sqlite3-shm"):
            p = root / name
            if p.exists():
                try:
                    os.chmod(p, 0o600)
                except OSError:
                    pass
                _owner(p, uid)


def _valid_bank(value: object) -> str:
    name = str(value or "workspace").strip()
    if not NAME_RE.fullmatch(name):
        raise ValueError("bank id must be 1-64 letters, numbers, dot, underscore or hyphen")
    return name


def _safe_source(home: Path, raw: object, resolver: Callable[[str], Path] | None) -> Path:
    value = str(raw or "").strip()
    if not value:
        raise ValueError("source_path is required when content is not supplied")
    path = resolver(value) if resolver else (home / value)
    if path.is_symlink():
        raise ValueError("symbolic links cannot be stored in a bank")
    resolved = path.resolve(strict=True)
    resolved.relative_to(home.resolve())
    if not resolved.is_file():
        raise ValueError("source_path must be a regular file inside this computer session")
    return resolved


def _compress(src: Path | None, raw: bytes | None, root: Path, uid: int | None) -> tuple[str, int, int, Path]:
    staging = root / ".staging"
    temp = staging / (uuid.uuid4().hex + ".part")
    digest = hashlib.sha256()
    size = 0
    compressor = zlib.compressobj(level=3)
    try:
        with temp.open("xb") as out:
            if raw is not None:
                chunks = (raw[i:i + 1024 * 1024] for i in range(0, len(raw), 1024 * 1024))
            if raw is not None:
                for block in chunks:
                    size += len(block)
                    digest.update(block)
                    packed = compressor.compress(block)
                    if packed:
                        out.write(packed)
            else:
                assert src is not None
                with src.open("rb") as input_file:
                    while True:
                        block = input_file.read(1024 * 1024)
                        if not block:
                            break
                        size += len(block)
                        if size > MAX_OBJECT_BYTES:
                            raise ValueError(f"file exceeds {MAX_OBJECT_BYTES // (1024 * 1024)} MB")
                        digest.update(block)
                        packed = compressor.compress(block)
                        if packed:
                            out.write(packed)
            tail = compressor.flush()
            if tail:
                out.write(tail)
        _owner(temp, uid)
        return digest.hexdigest(), size, temp.stat().st_size, temp
    except Exception:
        temp.unlink(missing_ok=True)
        raise


def _index_text(db: sqlite3.Connection, item_id: str, bank: str, text: str) -> int:
    cleaned = str(text or "")[:MAX_INDEX_CHARS].replace("\x00", "")
    chunks = [cleaned[i:i + CHUNK_CHARS] for i in range(0, len(cleaned), CHUNK_CHARS)]
    for number, body in enumerate(chunks):
        db.execute("INSERT INTO chunks(item_id,bank_id,chunk_no,body) VALUES(?,?,?,?)",
                   (item_id, bank, number, body))
        try:
            db.execute("INSERT INTO chunk_fts(item_id,bank_id,chunk_no,body) VALUES(?,?,?,?)",
                       (item_id, bank, number, body))
        except sqlite3.OperationalError:
            pass
    return len(cleaned)


def _extract_text(path: Path, size: int) -> str:
    if path.suffix.lower() in TEXT_SUFFIXES and size <= MAX_INDEX_CHARS * 4:
        try:
            return path.read_text(encoding="utf-8", errors="replace")[:MAX_INDEX_CHARS]
        except OSError:
            return ""
    if path.suffix.lower() == ".pdf" and shutil.which("pdftotext"):
        import subprocess
        try:
            result = subprocess.run(["pdftotext", "-layout", str(path), "-"],
                                    capture_output=True, text=True, timeout=20, check=False)
            if result.returncode == 0:
                return (result.stdout or "")[:MAX_INDEX_CHARS]
        except (OSError, subprocess.TimeoutExpired):
            pass
    return ""


def perform(
    home: Path,
    job: dict,
    *,
    quota_bytes: int,
    used_bytes: int,
    path_resolver: Callable[[str], Path] | None = None,
    owner_uid: int | None = None,
) -> dict:
    """Execute one bank action inside a single user:model workspace."""
    home = Path(home).resolve()
    action = str(job.get("bank_action") or job.get("operation") or "list").strip().lower()
    if action not in {"list", "create", "put", "get", "search", "stats", "delete", "drop", "link", "related"}:
        return {"ok": False, "error": "bank_action must be list, create, put, get, search, stats, delete or drop"}
    root = _root(home, owner_uid)
    db = _db(root, owner_uid)
    try:
        now = time.time()
        bank = _valid_bank(job.get("bank") or "workspace")
        if action == "create":
            category = str(job.get("category") or "general").strip().lower()
            if category not in {"general", "documents", "datasets", "apps", "tools", "sessions", "memory", "media", "projects"}:
                return {"ok": False, "error": "unsupported bank category"}
            db.execute("INSERT OR IGNORE INTO banks(id,category,description,created_at,updated_at) VALUES(?,?,?,?,?)",
                       (bank, category, str(job.get("description") or "")[:500], now, now))
            db.execute("UPDATE banks SET category=?,description=?,updated_at=? WHERE id=?",
                       (category, str(job.get("description") or "")[:500], now, bank))
            db.commit()
            return {"ok": True, "action": action, "bank": bank, "category": category}
        if action == "link":
            if not str(job.get("target_bank") or "").strip():
                return {"ok": False, "error": "target_bank is required for a bank link"}
            target_bank = _valid_bank(job.get("target_bank"))
            relation = str(job.get("relation") or "related").strip().lower()
            if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,31}", relation):
                return {"ok": False, "error": "relation must be 1-32 lowercase letters, numbers, dot, underscore or hyphen"}
            if not db.execute("SELECT 1 FROM banks WHERE id=?", (bank,)).fetchone():
                return {"ok": False, "error": f"source bank {bank!r} does not exist"}
            if not db.execute("SELECT 1 FROM banks WHERE id=?", (target_bank,)).fetchone():
                return {"ok": False, "error": f"target bank {target_bank!r} does not exist"}
            db.execute("INSERT OR IGNORE INTO bank_links(from_bank,to_bank,relation,note,created_at) VALUES(?,?,?,?,?)",
                       (bank, target_bank, relation, str(job.get("note") or "")[:300], now))
            db.commit()
            return {"ok": True, "action": action, "from_bank": bank, "to_bank": target_bank,
                    "relation": relation}
        if action == "related":
            links = [dict(row) for row in db.execute(
                "SELECT from_bank,to_bank,relation,note,created_at FROM bank_links "
                "WHERE from_bank=? OR to_bank=? ORDER BY created_at DESC LIMIT 200", (bank, bank)).fetchall()]
            return {"ok": True, "action": action, "bank": bank, "links": links}
        if action == "list":
            limit = max(1, min(200, int(job.get("limit") or 100)))
            offset = max(0, int(job.get("offset") or 0))
            banks = [dict(row) for row in db.execute(
                "SELECT b.id,b.category,b.description,b.created_at,b.updated_at,COUNT(i.id) AS items,"
                "COALESCE(SUM(i.size_bytes),0) AS logical_bytes FROM banks b LEFT JOIN items i ON i.bank_id=b.id "
                "GROUP BY b.id ORDER BY b.updated_at DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()]
            items = []
            if job.get("bank"):
                items = [dict(row) for row in db.execute(
                    "SELECT id,bank_id,name,kind,mime_type,sha256,size_bytes,compressed_bytes,text_chars,created_at "
                    "FROM items WHERE bank_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?", (bank, limit, offset)).fetchall()]
            return {"ok": True, "action": action, "banks": banks, "items": items, "limit": limit, "offset": offset}
        if action == "stats":
            rows = db.execute("SELECT COUNT(*) AS items,COALESCE(SUM(size_bytes),0) AS logical FROM items").fetchone()
            compressed = db.execute("SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM "
                                    "(SELECT MAX(compressed_bytes) AS size_bytes FROM items GROUP BY sha256)").fetchone()
            counts = db.execute("SELECT COUNT(*) AS banks FROM banks").fetchone()
            disk = shutil.disk_usage(home)
            return {"ok": True, "action": action, "banks": int(counts["banks"]),
                    "items": int(rows["items"]), "logical_bytes": int(rows["logical"]),
                    "compressed_bytes": int(compressed["bytes"]),
                    "free_bytes": int(disk.free), "quota_bytes": int(quota_bytes),
                    "session_used_bytes": int(used_bytes)}
        if action == "put":
            source = None
            raw = None
            if job.get("source_path"):
                source = _safe_source(home, job.get("source_path"), path_resolver)
                name = str(job.get("name") or source.name).strip()
                if source.stat().st_size > MAX_OBJECT_BYTES:
                    return {"ok": False, "error": f"file exceeds {MAX_OBJECT_BYTES // (1024 * 1024)} MB"}
            else:
                raw_text = job.get("content")
                if raw_text is None:
                    return {"ok": False, "error": "provide source_path or content"}
                raw = str(raw_text).encode("utf-8")
                if len(raw) > MAX_CONTENT_BYTES:
                    return {"ok": False, "error": f"content exceeds {MAX_CONTENT_BYTES // (1024 * 1024)} MB; write it to a file and use source_path"}
                name = str(job.get("name") or "note.txt").strip()
            name = Path(name).name[:240]
            if not name or name in {".", ".."}:
                return {"ok": False, "error": "a valid file name is required"}
            kind = str(job.get("kind") or "file").strip().lower()
            if kind not in {"file", "document", "dataset", "app", "tool", "session", "memory", "media", "project"}:
                kind = "file"
            metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
            sha, original_size, packed_size, temp = _compress(source, raw, root, owner_uid)
            try:
                with db:
                    if not db.execute("SELECT 1 FROM banks WHERE id=?", (bank,)).fetchone():
                        if bank != "workspace":
                            return {"ok": False, "error": f"bank {bank!r} does not exist; create it first"}
                        db.execute("INSERT INTO banks(id,category,description,created_at,updated_at) VALUES(?,?,?,?,?)",
                                   (bank, "general", "Default private computer bank", now, now))
                    existing = db.execute("SELECT id FROM items WHERE bank_id=? AND name=? AND sha256=?",
                                          (bank, name, sha)).fetchone()
                    if existing:
                        return {"ok": True, "action": action, "bank": bank, "item_id": existing["id"],
                                "name": name, "sha256": sha, "deduplicated": True, "size_bytes": original_size}
                    object_dir = root / "objects" / sha[:2]
                    object_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
                    _owner(object_dir, owner_uid)
                    stored = object_dir / (sha[2:] + ".z")
                    blob_reused = stored.exists()
                    if not blob_reused:
                        if used_bytes + packed_size > quota_bytes:
                            return {"ok": False, "error": "computer session storage quota reached; free space or add a persistent storage volume"}
                        reserve_gb = max(1, min(8, int(os.environ.get("COMPUTER_BANK_FREE_RESERVE_GB", "2"))))
                        if shutil.disk_usage(root).free < reserve_gb * 1024 ** 3:
                            return {"ok": False, "error": f"computer host disk reserve reached ({reserve_gb} GB must remain free); expand the Studio's persistent volume before storing more"}
                        os.replace(temp, stored)
                        os.chmod(stored, 0o600)
                        _owner(stored, owner_uid)
                    else:
                        temp.unlink(missing_ok=True)
                    item_id = uuid.uuid4().hex[:20]
                    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
                    db.execute("INSERT INTO items(id,bank_id,name,kind,mime_type,sha256,size_bytes,compressed_bytes,metadata,text_chars,created_at) "
                               "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                               (item_id, bank, name, kind, mime, sha, original_size, packed_size,
                                json.dumps(metadata, ensure_ascii=False)[:8000], 0, now))
                    text_value = str(job.get("text") or "")
                    if not text_value and source is not None:
                        text_value = _extract_text(source, original_size)
                    text_chars = _index_text(db, item_id, bank, text_value)
                    db.execute("UPDATE items SET text_chars=? WHERE id=?", (text_chars, item_id))
                    db.execute("UPDATE banks SET updated_at=? WHERE id=?", (now, bank))
                return {"ok": True, "action": action, "bank": bank, "item_id": item_id,
                        "name": name, "sha256": sha, "size_bytes": original_size,
                        "compressed_bytes": packed_size, "text_indexed_chars": text_chars,
                        "deduplicated": blob_reused}
            finally:
                temp.unlink(missing_ok=True)
        if action == "search":
            query = str(job.get("query") or "").strip()
            tokens = list(dict.fromkeys(TOKEN_RE.findall(query)))[:16]
            if not tokens:
                return {"ok": True, "action": action, "results": []}
            limit = max(1, min(MAX_RESULT, int(job.get("limit") or 8)))
            hits = []
            bank_filter = [bank] if job.get("bank") else []
            if bank_filter and job.get("include_related"):
                links = db.execute("SELECT from_bank,to_bank FROM bank_links WHERE from_bank=? OR to_bank=?",
                                   (bank, bank)).fetchall()
                for link in links:
                    neighbor = link["to_bank"] if link["from_bank"] == bank else link["from_bank"]
                    if neighbor not in bank_filter:
                        bank_filter.append(neighbor)
            bank_clause = ""
            bank_params: list[str] = []
            if bank_filter:
                bank_clause = "AND c.bank_id IN (" + ",".join("?" for _ in bank_filter) + ") "
                bank_params = bank_filter
            try:
                fts_query = " OR ".join('"' + token.replace('"', '""') + '"' for token in tokens)
                rows = db.execute(
                    "SELECT c.item_id,c.body,i.bank_id,i.name,i.kind,i.mime_type,i.size_bytes,i.sha256 "
                    "FROM chunk_fts c JOIN items i ON i.id=c.item_id WHERE chunk_fts MATCH ? "
                    + bank_clause + "ORDER BY bm25(chunk_fts) LIMIT ?",
                    (fts_query, *bank_params, limit),
                ).fetchall()
                hits = [dict(row) for row in rows]
            except sqlite3.OperationalError:
                fallback_clause = ("WHERE c.bank_id IN (" + ",".join("?" for _ in bank_filter) + ") ") if bank_filter else ""
                rows = db.execute(
                    "SELECT c.item_id,c.body,i.bank_id,i.name,i.kind,i.mime_type,i.size_bytes,i.sha256 "
                    "FROM chunks c JOIN items i ON i.id=c.item_id " + fallback_clause,
                    tuple(bank_filter),
                ).fetchall()
                for row in rows:
                    body = str(row["body"])
                    score = sum(body.lower().count(token.lower()) for token in tokens)
                    if score:
                        hits.append({**dict(row), "_score": score})
                hits.sort(key=lambda row: row.get("_score", 0), reverse=True)
                hits = hits[:limit]
            return {"ok": True, "action": action, "query": query,
                    "results": [{"item_id": row["item_id"], "bank": row["bank_id"], "name": row["name"],
                                 "kind": row["kind"], "mime_type": row["mime_type"], "size_bytes": row["size_bytes"],
                                 "sha256": row["sha256"], "excerpt": str(row["body"])[:1800]} for row in hits]}
        if action == "get":
            row = db.execute(
                "SELECT id,bank_id,name,kind,mime_type,sha256,size_bytes,compressed_bytes,text_chars,metadata "
                "FROM items WHERE id=? AND bank_id=?", (str(job.get("item_id") or ""), bank)
            ).fetchone()
            if not row:
                return {"ok": False, "error": "item not found in this bank"}
            stored = object_dir / row["sha256"][:2] / (row["sha256"][2:] + ".z")
            if not stored.is_file():
                return {"ok": False, "error": "bank object is missing"}
            if job.get("output_path"):
                target = path_resolver(str(job["output_path"]))
                target = Path(target).resolve()
                try:
                    target.relative_to(home)
                except ValueError:
                    return {"ok": False, "error": "restore path must stay inside this computer session"}
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                parent = target.parent
                while parent != home and home in parent.parents:
                    _owner(parent, owner_uid)
                    parent = parent.parent
                existing_size = target.stat().st_size if target.is_file() else 0
                additional = max(0, int(row["size_bytes"]) - existing_size)
                if max(0, used_bytes - existing_size) + int(row["size_bytes"]) > quota_bytes:
                    return {"ok": False, "error": "restored file would exceed this computer session's storage quota"}
                reserve_gb = max(1, min(8, int(os.environ.get("COMPUTER_BANK_FREE_RESERVE_GB", "2"))))
                if shutil.disk_usage(root).free < additional + reserve_gb * 1024 ** 3:
                    return {"ok": False, "error": f"host disk must keep {reserve_gb} GB free; there is not enough room to restore this item"}
                restore_tmp = target.with_name("." + target.name + ".restore-" + uuid.uuid4().hex[:8])
                decompressor = zlib.decompressobj()
                digest = hashlib.sha256()
                written = 0
                try:
                    with stored.open("rb") as inp, restore_tmp.open("wb") as out:
                        while True:
                            block = inp.read(CHUNK_BYTES)
                            if not block:
                                break
                            data = decompressor.decompress(block)
                            if data:
                                out.write(data)
                                digest.update(data)
                                written += len(data)
                        tail = decompressor.flush()
                        if tail:
                            out.write(tail)
                            digest.update(tail)
                            written += len(tail)
                    if written != int(row["size_bytes"]) or digest.hexdigest() != row["sha256"]:
                        return {"ok": False, "error": "bank object checksum or size verification failed"}
                    os.replace(restore_tmp, target)
                    try:
                        os.chmod(target, 0o700 if row["kind"] in {"app", "tool"} else 0o600)
                    except OSError:
                        pass
                    _owner(target, owner_uid)
                    return {"ok": True, "action": action, "item_id": row["id"], "path": str(target.relative_to(home)),
                            "bytes": written, "kind": row["kind"], "sha256": row["sha256"]}
                finally:
                    restore_tmp.unlink(missing_ok=True)
            if row["text_chars"]:
                text = _read_item_text(db, row["id"])
                return {"ok": True, "action": action, "item_id": row["id"], "name": row["name"],
                        "kind": row["kind"], "text": text}
            return {"ok": False, "error": "output_path is required to restore this binary item"}
        if action == "delete":
            item_id = str(job.get("item_id") or "").strip()
            if not item_id:
                return {"ok": False, "error": "item_id is required"}
            row = db.execute("SELECT sha256 FROM items WHERE id=? AND bank_id=?", (item_id, bank)).fetchone()
            if not row:
                return {"ok": False, "error": "bank item not found"}
            with db:
                db.execute("DELETE FROM chunks WHERE item_id=?", (item_id,))
                try:
                    db.execute("DELETE FROM chunk_fts WHERE item_id=?", (item_id,))
                except sqlite3.OperationalError:
                    pass
                db.execute("DELETE FROM items WHERE id=?", (item_id,))
            still_used = db.execute("SELECT 1 FROM items WHERE sha256=? LIMIT 1", (row["sha256"],)).fetchone()
            removed = False
            if not still_used:
                object_file = root / "objects" / row["sha256"][:2] / (row["sha256"][2:] + ".z")
                object_file.unlink(missing_ok=True)
                removed = True
            return {"ok": True, "action": action, "item_id": item_id, "blob_removed": removed}
        if action == "drop":
            if not job.get("confirm"):
                return {"ok": False, "error": "set confirm=true to remove a whole bank"}
            if bank == "workspace":
                return {"ok": False, "error": "the default workspace bank cannot be dropped"}
            row = db.execute("SELECT id FROM banks WHERE id=?", (bank,)).fetchone()
            if not row:
                return {"ok": False, "error": "bank not found"}
            hashes = [x["sha256"] for x in db.execute("SELECT sha256 FROM items WHERE bank_id=?", (bank,))]
            with db:
                db.execute("DELETE FROM chunks WHERE bank_id=?", (bank,))
                try:
                    db.execute("DELETE FROM chunk_fts WHERE bank_id=?", (bank,))
                except sqlite3.OperationalError:
                    pass
                db.execute("DELETE FROM banks WHERE id=?", (bank,))
            removed = 0
            for sha in set(hashes):
                if not db.execute("SELECT 1 FROM items WHERE sha256=? LIMIT 1", (sha,)).fetchone():
                    (root / "objects" / sha[:2] / (sha[2:] + ".z")).unlink(missing_ok=True)
                    removed += 1
            return {"ok": True, "action": action, "bank": bank, "objects_removed": removed}
        return {"ok": False, "error": "unsupported bank action"}
    except (ValueError, OSError, sqlite3.Error, zlib.error) as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:300]}"}
    finally:
        _finish_db(db, root, owner_uid)
