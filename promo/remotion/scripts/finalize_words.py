"""Merge spoken brand «شام إيه آي» into caption «شام AI»; build props.json for Remotion."""
import json, re
w = json.load(open("public/words.json")); ep = json.load(open("episode.json"))
def restore_punctuation(words, script):
    """The TTS boundaries drop punctuation (English especially), so captions broke mid-phrase ("birthday your anniversary").
    Walk the script and give each spoken word back the comma / full stop / question mark it had, so the caption pages break where the sentence does."""
    norm = lambda x: re.sub(r"\W", "", x.lower())
    toks, j = script.split(), 0
    for word in words:
        for k in range(j, min(j + 4, len(toks))):
            if norm(toks[k]) and norm(toks[k]) == norm(word["text"]):
                word["text"] = toks[k]; j = k + 1; break
    return words

if ep.get("lang") == "en":
    w = restore_punctuation(w, ep["script"])
out, i = [], 0
while i < len(w):
    t = w[i]["text"].strip("،,.؟?!")
    if t == "شام" and i + 2 < len(w) and w[i+1]["text"].startswith("إيه") and w[i+2]["text"].startswith("آي"):
        out.append({"text": "شام AI", "startMs": w[i]["startMs"], "endMs": w[i+2]["endMs"]}); i += 3; continue
    out.append(w[i]); i += 1
import subprocess
dur = float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0","public/voice.mp3"]).decode())
extra = {k: ep[k] for k in ("lang", "brand", "ctaTitle", "ctaLine") if k in ep}
json.dump({"title": ep["title"], "hook": ep["hook"], "words": out, "voiceSec": dur, **extra}, open("props.json","w"), ensure_ascii=False)
print("props ok", len(out), dur)
