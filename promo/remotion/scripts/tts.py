"""edge-tts (free) -> public/voice.mp3 + public/words.json (word boundaries in ms)."""
import asyncio, json, sys
import edge_tts

async def main(text, voice, rate, out_dir):
    c = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    words = []
    with open(f"{out_dir}/voice.mp3", "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                s = ch["offset"] / 10000
                words.append({"text": ch["text"], "startMs": round(s), "endMs": round(s + ch["duration"] / 10000)})
    json.dump(words, open(f"{out_dir}/words.json", "w"), ensure_ascii=False)
    print(len(words), "words")

asyncio.run(main(*sys.argv[1:5]))
