"""Read-only check of Sham v2's OWN token media generator (the "شام الداخلي" route), on CPU. Downloads the checkpoint + tokenizer of novaai2026/sham-v2 (no media bundle), loads it
exactly like the Studio (serve.load_model), then runs sham_studio_media.make_media for an image and an audio prompt and applies media_quality.check_*. Prints RESULT lines; never fails the job
on a quality refusal (that IS the answer), only on a crash before the verdict."""
import base64, glob, json, os, sys, time
HERE = os.path.join(os.getcwd(), "ai-system", "colab", "sham_small")
sys.path.insert(0, HERE)
out = os.environ.get("OUT", "out"); os.makedirs(out, exist_ok=True)
res = {}
def done(): json.dump(res, open(os.path.join(out, "result.json"), "w"), ensure_ascii=False, indent=1); print("RESULT", json.dumps(res, ensure_ascii=False))
t0 = time.time()
from modelscope import snapshot_download
from modelscope.hub.api import HubApi
HubApi().login(os.environ["MODELSCOPE_TOKEN"])
path = snapshot_download(os.environ.get("MODEL", "novaai2026/sham-v2"), cache_dir="_m", allow_file_pattern=["*.pt", "*.json", "*.txt", "*.model"])
files = sorted(os.path.relpath(p, path) + f" {os.path.getsize(p) // 2**20}MB" for p in glob.glob(path + "/**/*", recursive=True) if os.path.isfile(p))
print("FILES", files[:40]); res["files"] = files[:40]; res["download_s"] = round(time.time() - t0, 1)
ckpt = next(iter(sorted(glob.glob(path + "/**/final_merged.pt", recursive=True))), None) or next(iter(sorted(glob.glob(path + "/**/*.pt", recursive=True))), None)
tok = next(iter(sorted(glob.glob(path + "/**/sham_small_tokenizer.json", recursive=True))), None)
res["checkpoint"] = ckpt and os.path.relpath(ckpt, path)
if not ckpt or not tok: res["verdict"] = "no checkpoint/tokenizer in the repo"; done(); sys.exit(0)
import serve
t1 = time.time()
try:
    serve.load_model(checkpoint_path=ckpt, tokenizer_path=tok)
except Exception as e:
    res["load_error"] = f"{type(e).__name__}: {str(e)[:300]}"; res["verdict"] = "the internal generator cannot even load"; done(); sys.exit(0)
res["load_s"] = round(time.time() - t1, 1); res["source"] = str(serve._state.get("source", ""))
import sham_studio_media as M
from media_quality import MediaQualityError, check_image, check_wav
st = serve._state
for kind, prompt, chk, ext in (("image", "a red apple on a white table", check_image, "png"), ("audio", "مرحبا بك", check_wav, "wav")):
    t = time.time(); r = {}
    try:
        m = M.make_media(st["model"], st["text_tokenizer"], st["image_tokenizer"], st["audio_tokenizer"], kind, prompt)
        r["secs"] = round(time.time() - t, 1); r["type"] = m.get("type")
        if m.get("b64"):
            raw = base64.b64decode(m["b64"]); open(os.path.join(out, f"internal.{ext}"), "wb").write(raw); r["bytes"] = len(raw)
            try: r["quality"] = "PASS " + json.dumps(chk(raw), default=str)[:300]
            except MediaQualityError as e: r["quality"] = f"REFUSED {e.reason}: {e.detail}"
        else: r["text"] = str(m.get("text"))[:200]
    except Exception as e:
        r["secs"] = round(time.time() - t, 1); r["error"] = f"{type(e).__name__}: {str(e)[:300]}"
    res[kind] = r
res["video"] = M.make_media(st["model"], st["text_tokenizer"], st["image_tokenizer"], st["audio_tokenizer"], "video", "x").get("text", "")[:160]
done()
