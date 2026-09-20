"""
Sham — real per-organization API keys, replacing the single
shared "magic code" idea with the way every real API provider (Stripe,
GitHub, etc.) actually does this: one real, high-entropy secret PER
ORGANIZATION, stored as a HASH (never plaintext), individually
revocable, individually logged. A single hardcoded secret baked into
the codebase is a real, well-known security anti-pattern regardless of
intent — it lives forever in git history, can't tell one user from
another, can't be revoked without a code change and redeploy, and
nothing logs who used it. None of that is true of what's built here.

Why SHA-256 (a fast hash) rather than a slow password hash like
bcrypt/argon2: the threat model is different from passwords. A real
API key here has ~256 bits of real random entropy (see
generate_api_key() below) — nobody is going to brute-force that
regardless of hash speed. The real risk a hash defends against is a
database leak exposing usable keys directly; a fast cryptographic hash
already makes a leaked row useless without the original key, which is
the actual property needed. This is the same real, standard choice
GitHub and Stripe both document publicly for their own API key storage.

Storage: real SQLite by default (Python's stdlib sqlite3 — zero extra
dependency, fully real and testable right now, and genuinely
deployable on Render as-is). Swapping to Supabase later, for
durability across redeploys, is a real, easy upgrade — it would reuse
the exact same REST pattern already proven throughout this project
(data_acquisition.py, gather_knowledge.py): a new ShamSmallApiKey table
with the same columns this module already tracks (org_name, key_hash,
created_at, revoked, last_used_at) — the interface below
(OrganizationKeyStore) is deliberately storage-agnostic so that swap
would only touch this one file, not any caller of it.
"""

import hashlib
import secrets
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path


def generate_api_key() -> str:
    """A real, cryptographically secure random key (256 bits of real
    entropy via Python's secrets module — the standard, correct source
    for security tokens, never random.random() or anything homemade).
    Prefixed so a key is recognizable at a glance in logs without
    revealing anything about its value."""
    return f"sham_org_{secrets.token_urlsafe(32)}"


def _hash_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


@dataclass
class Organization:
    org_id: int
    name: str
    created_at: float
    revoked: bool
    last_used_at: float | None


class OrganizationKeyStore:
    """Real SQLite-backed storage — every method here does a real
    database operation, not an in-memory placeholder. See this
    module's own docstring for the honest, documented path to swapping
    in Supabase later without touching any calling code."""

    def __init__(self, db_path: str = "sham_small_api_keys.db"):
        self.db_path = db_path
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS organizations (
                    org_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    key_hash TEXT NOT NULL UNIQUE,
                    created_at REAL NOT NULL,
                    revoked INTEGER NOT NULL DEFAULT 0,
                    last_used_at REAL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS usage_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    org_id INTEGER NOT NULL,
                    endpoint TEXT NOT NULL,
                    detail TEXT,
                    timestamp REAL NOT NULL,
                    FOREIGN KEY (org_id) REFERENCES organizations(org_id)
                )
            """)

    def register_organization(self, name: str) -> str:
        """Creates a real new organization and returns its real API
        key ONCE — exactly like every real provider does (Stripe,
        GitHub): the plaintext key is shown to the caller here and
        then never again; only its hash is stored, so even this
        module's own operator can't recover a lost key later, only
        revoke it and issue a new one."""
        api_key = generate_api_key()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO organizations (name, key_hash, created_at, revoked) VALUES (?, ?, ?, 0)",
                (name, _hash_key(api_key), time.time()),
            )
        return api_key

    def verify_api_key(self, presented_key: str) -> Organization | None:
        """Returns the real Organization if presented_key hashes to a
        real, non-revoked row; None otherwise (wrong key, unknown key,
        or a real key that was explicitly revoked) — the caller (an
        HTTP endpoint) must treat None as "reject the request"."""
        key_hash = _hash_key(presented_key)
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM organizations WHERE key_hash = ? AND revoked = 0", (key_hash,)
            ).fetchone()
        if row is None:
            return None
        return Organization(
            org_id=row["org_id"], name=row["name"], created_at=row["created_at"],
            revoked=bool(row["revoked"]), last_used_at=row["last_used_at"],
        )

    def revoke_organization(self, org_id: int) -> None:
        """Revokes ONLY this one organization's key — every other
        organization's access is completely unaffected, the real
        property a single shared secret could never have offered."""
        with self._connect() as conn:
            conn.execute("UPDATE organizations SET revoked = 1 WHERE org_id = ?", (org_id,))

    def record_usage(self, org_id: int, endpoint: str, detail: str | None = None) -> None:
        """A real, queryable audit trail — which organization used
        which endpoint, when, and (for the authenticated medical/
        research endpoints, which no longer run free text through a
        content filter — see serve.py) what the actual request text
        was. This is what makes post-hoc review possible at all: an
        operator can pull an organization's real request history via
        get_usage_log() and decide, from real content, whether that
        organization is asking for things outside its stated purpose —
        and revoke its key if so. Without storing `detail`, there would
        be nothing to review and "monitoring" would be a name for doing
        nothing."""
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO usage_log (org_id, endpoint, detail, timestamp) VALUES (?, ?, ?, ?)",
                (org_id, endpoint, detail, now),
            )
            conn.execute("UPDATE organizations SET last_used_at = ? WHERE org_id = ?", (now, org_id))

    def usage_count(self, org_id: int) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS c FROM usage_log WHERE org_id = ?", (org_id,)).fetchone()
        return row["c"]

    def get_usage_log(self, org_id: int, limit: int = 200) -> list["UsageLogEntry"]:
        """Real request history for one organization, newest first —
        the actual tool a trusted operator uses to spot an organization
        asking for things unrelated to its stated purpose, per the
        revoke-on-misuse model this project now relies on instead of a
        live content filter for these endpoints."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT endpoint, detail, timestamp FROM usage_log WHERE org_id = ? ORDER BY timestamp DESC LIMIT ?",
                (org_id, limit),
            ).fetchall()
        return [UsageLogEntry(endpoint=r["endpoint"], detail=r["detail"], timestamp=r["timestamp"]) for r in rows]


@dataclass
class UsageLogEntry:
    endpoint: str
    detail: str | None
    timestamp: float


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = str(Path(tmpdir) / "test_keys.db")
        store = OrganizationKeyStore(db_path)

        # --- 1. Register two real, independent organizations --------
        key_a = store.register_organization("Example Medical University")
        key_b = store.register_organization("Example Research Institute")
        assert key_a != key_b, "two organizations must never receive the same key"
        assert key_a.startswith("sham_org_") and len(key_a) > 40, f"key doesn't look like real high-entropy secret: {key_a}"
        print(f"registered 2 real organizations with 2 distinct real high-entropy keys "
              f"(e.g. {key_a[:16]}...).")

        # --- 2. The real key verifies; a wrong key does not ---------
        org_a = store.verify_api_key(key_a)
        assert org_a is not None and org_a.name == "Example Medical University"
        assert store.verify_api_key("sham_org_totally-made-up-wrong-key") is None
        assert store.verify_api_key(key_b).name == "Example Research Institute"
        print("verify_api_key OK: the real key for each org resolves to that exact org; a made-up key resolves to nothing.")

        # --- 3. Revoking org A does not affect org B (the real point
        #        of per-organization keys over one shared secret) -----
        store.revoke_organization(org_a.org_id)
        assert store.verify_api_key(key_a) is None, "revoked org A's key must stop working"
        assert store.verify_api_key(key_b) is not None, "revoking org A must NOT affect org B"
        print("revoke_organization OK: revoking one organization's key does not touch any other organization's access.")

        # --- 4. Real usage logging, including the real request text so
        #        post-hoc review is actually possible ------------------
        org_b = store.verify_api_key(key_b)
        store.record_usage(org_b.org_id, "/ask/image", detail="what is this structure?")
        store.record_usage(org_b.org_id, "/ask/video", detail="describe the procedure shown")
        assert store.usage_count(org_b.org_id) == 2
        log = store.get_usage_log(org_b.org_id)
        assert len(log) == 2
        assert log[0].endpoint == "/ask/video" and log[0].detail == "describe the procedure shown"
        assert log[1].endpoint == "/ask/image" and log[1].detail == "what is this structure?"
        print("record_usage/get_usage_log OK: 2 real calls logged for org B, newest first, WITH the real "
              "request text — this is the real data an operator reviews to catch misuse and revoke a key.")

        # --- 5. Persistence: a FRESH store instance pointed at the same
        #        db file must see the exact same state, proving this is
        #        real durable storage, not in-memory state that happens
        #        to survive within one process.
        reloaded_store = OrganizationKeyStore(db_path)
        assert reloaded_store.verify_api_key(key_b) is not None
        assert reloaded_store.verify_api_key(key_a) is None
        assert reloaded_store.usage_count(org_b.org_id) == 2
        print("persistence OK: a fresh store instance reading the same database file sees identical, real state.")

    print("\nAll API key checks passed — real per-organization keys, hashed storage, independent "
          "revocation, and a real usage audit trail all work correctly.")
