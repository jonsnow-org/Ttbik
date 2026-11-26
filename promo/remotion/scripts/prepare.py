"""Select the next unrendered, eligible Remotion episode.

Usage: prepare.py <done_ids_csv> [forced_id]
Success prints exactly one episode id and writes episode.json.
An empty queue or a queue whose remaining episodes are gated is a hard error,
not a successful no-op that silently skips render and publishing.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path
from typing import Any, Iterable


def is_ready(episode: dict[str, Any], launched: bool = False, opened: bool = False) -> bool:
    need = episode.get("needs")
    return need is None or (need == "znbt" and launched) or (need == "platform" and opened)


def select_episode(
    episodes: Iterable[dict[str, Any]],
    done_ids: set[int],
    forced_id: str = "",
    launched: bool = False,
    opened: bool = False,
) -> dict[str, Any] | None:
    items = list(episodes)
    if forced_id:
        # Preserve the existing explicit re-render behavior for owner-dispatched runs.
        return next((item for item in items if str(item.get("id")) == forced_id), None)
    return next(
        (item for item in items if int(item["id"]) not in done_ids and is_ready(item, launched, opened)),
        None,
    )


def no_episode_reason(
    episodes: Iterable[dict[str, Any]],
    done_ids: set[int],
    forced_id: str = "",
    launched: bool = False,
    opened: bool = False,
) -> str:
    items = list(episodes)
    if forced_id:
        return f"FORCED_EPISODE_NOT_FOUND: episode id {forced_id!r} is not present in episodes.json."
    remaining = [item for item in items if int(item["id"]) not in done_ids]
    if not remaining:
        return (
            f"QUEUE_EXHAUSTED: all {len(items)} configured episode(s) already have promo-ep-N releases. "
            "Add a new reviewed episode to episodes.json; refusing a green no-op run."
        )
    blocked = [item for item in remaining if not is_ready(item, launched, opened)]
    blocked_ids = ", ".join(str(item["id"]) for item in blocked)
    return (
        "NO_READY_EPISODE: unrendered episodes remain but their prerequisites are not satisfied"
        + (f" (blocked ids: {blocked_ids})." if blocked_ids else ".")
    )


def znbt_state(cfg: dict[str, Any]) -> tuple[bool, bool]:
    for base in (cfg.get("gate"), cfg.get("site")):
        if not base:
            continue
        try:
            with urllib.request.urlopen(str(base).rstrip("/") + "/zenobia/znbt/config.json", timeout=20) as response:
                config = json.load(response)
            launched = bool(config.get("curve"))
            return launched, launched and bool(config.get("open"))
        except Exception:
            continue
    return False, False


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if not args:
        print("Usage: prepare.py <done_ids_csv> [forced_id]", file=sys.stderr)
        return 2
    try:
        done_ids = {int(value) for value in args[0].split(",") if value.strip()}
    except ValueError:
        print("INVALID_RELEASE_STATE: release IDs must be comma-separated integers.", file=sys.stderr)
        return 2

    forced_id = args[1] if len(args) > 1 else ""
    try:
        cfg = json.loads(Path("episodes.json").read_text(encoding="utf-8"))
        episodes = cfg["episodes"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        print(f"INVALID_EPISODE_CATALOG: {exc}", file=sys.stderr)
        return 2

    launched, opened = znbt_state(cfg)
    episode = select_episode(episodes, done_ids, forced_id, launched, opened)
    if episode is None:
        print(no_episode_reason(episodes, done_ids, forced_id, launched, opened), file=sys.stderr)
        return 3

    payload = {
        **{key: value for key, value in cfg.items() if key != "episodes"},
        **episode,
        "site": episode.get("site", cfg["site"]),
        "voice": episode.get("voice", cfg["voice"]),
        "rate": episode.get("rate", cfg["rate"]),
    }
    Path("episode.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(episode["id"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
