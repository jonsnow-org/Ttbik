"""Pick next unrendered, ready episode, write episode.json. Usage: prepare.py <done_ids_csv> [forced_id] -> prints episode id (or nothing).
An episode with "needs": "znbt" / "platform" waits until the owner has launched ZNBt / opened the platform (read from the site's znbt config)."""
import json, sys, urllib.request
done = {int(x) for x in sys.argv[1].split(",") if x.strip()}
cfg = json.load(open("episodes.json"))
force = sys.argv[2] if len(sys.argv) > 2 else ""

def znbt_state():
    for base in (cfg.get("gate"), cfg["site"]):
        if not base:
            continue
        try:
            with urllib.request.urlopen(base + "/zenobia/znbt/config.json", timeout=20) as r:
                c = json.load(r)
            return bool(c.get("curve")), bool(c.get("curve")) and bool(c.get("open"))
        except Exception:
            continue
    return False, False

launched, opened = znbt_state()
def ready(e):
    need = e.get("needs")
    return need is None or (need == "znbt" and launched) or (need == "platform" and opened)

eps = [e for e in cfg["episodes"] if (str(e["id"]) == force if force else (e["id"] not in done and ready(e)))]
if not eps:
    sys.exit(0)
e = eps[0]
json.dump({**{k: v for k, v in cfg.items() if k != "episodes"}, **e, "site": e.get("site", cfg["site"]), "voice": e.get("voice", cfg["voice"]), "rate": e.get("rate", cfg["rate"])}, open("episode.json", "w"), ensure_ascii=False)
print(e["id"])
