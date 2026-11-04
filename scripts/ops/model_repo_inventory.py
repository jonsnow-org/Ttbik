"""Read-only inventory of the account's ModelScope MODEL repos (not Studios): name, visibility,
total size and the largest weight files. Used to locate forgotten weights (owner 2026-11-04).
Never prints the token or file contents; names and sizes only."""
from __future__ import annotations

import json
import os
import sys

OWNER = os.environ.get("MS_OWNER", "novaai2026")
WEIGHT_EXT = (".gguf", ".safetensors", ".bin", ".pt", ".pth", ".onnx", ".ckpt")


def main() -> int:
    token = os.environ.get("MODELSCOPE_TOKEN", "").strip()
    if not token:
        print("MODELSCOPE_TOKEN missing")
        return 1
    from modelscope.hub.api import HubApi

    api = HubApi()
    api.login(token)
    repos: list[dict] = []
    page = 1
    while True:
        try:
            res = api.list_models(OWNER, page_number=page, page_size=50, token=token)
        except Exception as exc:  # noqa: BLE001
            print(f"list_models failed page={page}: {type(exc).__name__}: {str(exc)[:200]}")
            break
        models = (res or {}).get("Models") or []
        repos.extend(models)
        total = (res or {}).get("TotalCount") or 0
        if not models or len(repos) >= total:
            break
        page += 1
    print(f"model repos listed for {OWNER}: {len(repos)}")
    rows = []
    for m in repos:
        if not rows:
            print("repo keys:", sorted(m.keys()))
        name = str(m.get("Name") or m.get("name") or m.get("Path") or m.get("id") or "?")
        mid = name if "/" in name else f"{OWNER}/{name}"
        row = {"repo": mid, "visibility": m.get("Visibility", m.get("visibility")), "updated": str(m.get("LastUpdatedTime") or m.get("last_modified") or m.get("updated_at") or "")[:25]}
        try:
            try:
                files = api.get_model_files(mid, recursive=True, token=token)
            except TypeError:
                files = api.get_model_files(mid, recursive=True)
            sizes = [(f.get("Path") or f.get("Name"), int(f.get("Size") or 0)) for f in files if f.get("Type") != "tree"]
            row["files"] = len(sizes)
            row["total_gb"] = round(sum(s for _, s in sizes) / 2**30, 2)
            weights = sorted([x for x in sizes if str(x[0]).lower().endswith(WEIGHT_EXT)], key=lambda x: -x[1])
            row["weights"] = [{"path": p, "gb": round(s / 2**30, 2)} for p, s in weights[:12]]
            row["other"] = [p for p, _ in sizes if not str(p).lower().endswith(WEIGHT_EXT)][:15]
        except Exception as exc:  # noqa: BLE001
            row["error"] = f"{type(exc).__name__}: {str(exc)[:160]}"
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False))
    try:
        from modelscope.hub.api import HubApi as _H  # datasets may also hold weights
        ds = api.list_datasets(owner=OWNER, token=token)
        items = getattr(ds, "items", None) or []
        print("datasets:", [str(getattr(i, "name", None) or getattr(i, "id", None) or i)[:80] for i in items])
    except Exception as exc:  # noqa: BLE001
        print(f"datasets listing failed: {type(exc).__name__}: {str(exc)[:160]}")
    print("=== summary (largest first) ===")
    for r in sorted(rows, key=lambda r: -(r.get("total_gb") or 0)):
        w = ", ".join(x["path"] for x in (r.get("weights") or [])[:3])
        print(f"{r.get('total_gb', '?'):>8} GB  {r['repo']}  [{r.get('visibility')}]  {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
