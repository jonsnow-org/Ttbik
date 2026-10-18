"""Merge spoken brand «شام إيه آي» into caption «شام AI»; build props.json for Remotion."""
import json
w = json.load(open("public/words.json")); ep = json.load(open("episode.json"))
out, i = [], 0
while i < len(w):
    t = w[i]["text"].strip("،,.؟?!")
    if t == "شام" and i + 2 < len(w) and w[i+1]["text"].startswith("إيه") and w[i+2]["text"].startswith("آي"):
        out.append({"text": "شام AI", "startMs": w[i]["startMs"], "endMs": w[i+2]["endMs"]}); i += 3; continue
    out.append(w[i]); i += 1
import subprocess
dur = float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0","public/voice.mp3"]).decode())
json.dump({"title": ep["title"], "hook": ep["hook"], "words": out, "voiceSec": dur}, open("props.json","w"), ensure_ascii=False)
print("props ok", len(out), dur)
