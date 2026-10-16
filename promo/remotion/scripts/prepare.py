"""Pick next unrendered episode, write props.json. Usage: prepare.py <done_ids_csv> -> prints episode id (or nothing)."""
import json, sys
done = {int(x) for x in sys.argv[1].split(",") if x.strip()}
cfg = json.load(open("episodes.json"))
force = sys.argv[2] if len(sys.argv) > 2 else ""
eps = [e for e in cfg["episodes"] if (str(e["id"]) == force if force else e["id"] not in done)]
if not eps: sys.exit(0)
e = eps[0]
json.dump({**e, "site": cfg["site"], "voice": cfg["voice"], "rate": cfg["rate"]}, open("episode.json", "w"), ensure_ascii=False)
print(e["id"])
