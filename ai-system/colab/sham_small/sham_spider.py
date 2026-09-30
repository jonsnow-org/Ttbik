"""
Sham's spider network ("الشبكة العنكبوتية للتغذيات") — the collection half of
the live trainer (sham_live.py). It rebuilds the engineer's fetch thread,
which looped over 8 fixed URLs (one audio file and one video file fetched
again and again, news FRONT PAGES, captionless random photos), into a
network of many free sources that keeps finding NEW material:

  text   Arabic Wikipedia (random + following each article's links),
         Wikinews, Wikisource, Wikibooks, Wikiquote, Wikivoyage (Arabic),
         9 Arabic news RSS feeds (headline + summary), and every news item
         sends its key words to Arabic Wikipedia search so the background
         article joins the frontier (news → knowledge)
  image  images WITH captions: the lead image of each Arabic Wikipedia
         article (Arabic caption), Wikimedia Commons, NASA, Art Institute
         of Chicago (public domain), The Met (public domain), Openverse
         (CC, commercial-use licences)
  audio  Lingua Libre Arabic word recordings (the word is the transcript),
         plus the licensed Arabic speech sets already used by the stages
         (Common Voice, FLEURS, ClArTTS, ArVoice) through sham_data_sources
  video  Wikimedia Commons videos (smallest transcode), NASA videos
         (mobile/small mp4), Kinetics CC clips through sham_data_sources

How it stays fast and polite:
  • many worker threads (I/O bound); one keep-alive HTTP session per thread
  • per-host pacing + Retry-After / exponential back-off on 429/5xx
  • a source that keeps failing is rested (circuit breaker) and retried later
  • each worker picks the modality most behind its target share, then the
    source with the best recent yield in that modality (adaptive)
  • every item is fingerprinted; nothing is ever emitted twice, across
    sessions too (the fingerprints are saved with the checkpoint)
"""

from __future__ import annotations

import hashlib
import html
import io
import json
import queue
import random
import re
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

UA = "ShamResearchBot/1.0 (+https://github.com/jonsnow-org/Ttbik; research, polite)"
MAX_MEDIA_BYTES = 25 * 1024 * 1024
NEWS_IMAGES = False  # news photos are usually copyrighted — off unless the owner decides otherwise

# ---------------------------------------------------------------- item

@dataclass
class Item:
    kind: str                      # text | image | audio | video
    text: str                      # article / caption / transcript
    source: str
    data: bytes | None = None      # media bytes (image/audio/video)
    license: str = ""
    key: str = ""                  # dedupe fingerprint


def fingerprint(kind: str, text: str, data: bytes | None) -> str:
    h = hashlib.sha1(kind.encode())
    if data:
        h.update(data[:2_000_000])
    else:
        h.update(" ".join(text.split()).encode("utf-8"))
    return h.hexdigest()[:20]


class Seen:
    """Thread-safe fingerprint set, persisted with the checkpoint."""

    def __init__(self, keys=()):
        self._keys = set(keys)
        self._lock = threading.Lock()

    def add_new(self, key: str) -> bool:
        with self._lock:
            if key in self._keys:
                return False
            self._keys.add(key)
            return True

    def __len__(self):
        return len(self._keys)

    def save(self, path):
        with self._lock:
            Path(path).write_text(json.dumps(sorted(self._keys)), encoding="utf-8")

    @classmethod
    def load(cls, path):
        try:
            return cls(json.loads(Path(path).read_text(encoding="utf-8")))
        except Exception:
            return cls()


# ---------------------------------------------------------------- polite HTTP

class Pacer:
    """Per-host minimum interval between requests + back-off after 429/5xx."""

    def __init__(self, default_gap: float = 0.25, gaps: dict | None = None):
        self.default_gap = default_gap
        self.gaps = gaps or {}
        self._next = {}
        self._lock = threading.Lock()

    def busy_for(self, host: str) -> float:
        with self._lock:
            return self._next.get(host, 0.0) - time.time()

    def wait(self, host: str):
        gap = next((g for h, g in self.gaps.items() if host.endswith(h)), self.default_gap)
        with self._lock:
            now = time.time()
            t = max(now, self._next.get(host, 0.0))
            self._next[host] = t + gap
        if t > now:
            time.sleep(t - now)

    def penalize(self, host: str, seconds: float):
        with self._lock:
            self._next[host] = max(self._next.get(host, 0.0), time.time() + seconds)


PACER = Pacer(0.2, {"wikipedia.org": 0.4, "wikimedia.org": 0.6, "wikinews.org": 0.4, "wikisource.org": 0.4,
                    "wikibooks.org": 0.4, "wikiquote.org": 0.4, "wikivoyage.org": 0.4, "openverse.org": 1.0,
                    "metmuseum.org": 0.3})
_local = threading.local()


def _session():
    import requests

    s = getattr(_local, "session", None)
    if s is None:
        s = requests.Session()
        s.headers.update({"User-Agent": UA, "Accept-Encoding": "gzip, deflate"})
        _local.session = s
    return s


def http_get(url: str, params: dict | None = None, timeout: float = 20, max_bytes: int | None = None,
             tries: int = 3, headers: dict | None = None) -> bytes | None:
    host = urllib.parse.urlparse(url).netloc
    for attempt in range(tries):
        if PACER.busy_for(host) > 30:
            return None  # this host asked us to back off: let the worker serve another source meanwhile
        PACER.wait(host)
        try:
            with _session().get(url, params=params, timeout=timeout, stream=max_bytes is not None, headers=headers) as r:
                if r.status_code in (429, 503, 502, 504):
                    retry = r.headers.get("retry-after")
                    wait = float(retry) if retry and retry.replace(".", "").isdigit() else 2.0
                    PACER.penalize(host, min(wait * (2 ** attempt), 120))
                    continue
                if r.status_code != 200:
                    return None
                if max_bytes is None:
                    return r.content
                buf = io.BytesIO()
                for chunk in r.iter_content(1 << 16):
                    buf.write(chunk)
                    if buf.tell() > max_bytes:
                        return None  # too big for a training sample
                return buf.getvalue()
        except Exception:
            PACER.penalize(host, 1.0 * (attempt + 1))
    return None


def get_json(url, params=None, timeout=20):
    raw = http_get(url, params, timeout)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def clean(text: str, limit: int | None = None) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = re.sub(r"[​-‏⁠﻿]", "", text)
    text = " ".join(text.split())
    return text[:limit] if limit else text


# ---------------------------------------------------------------- sources

WIKI_PROJECTS = {
    "wiki_ar": "https://ar.wikipedia.org/w/api.php",
    "wikinews_ar": "https://ar.wikinews.org/w/api.php",
    "wikisource_ar": "https://ar.wikisource.org/w/api.php",
    "wikibooks_ar": "https://ar.wikibooks.org/w/api.php",
    "wikiquote_ar": "https://ar.wikiquote.org/w/api.php",
    "wikivoyage_ar": "https://ar.wikivoyage.org/w/api.php",
}
COMMONS = "https://commons.wikimedia.org/w/api.php"
RSS_FEEDS = {
    "bbc_ar": "https://feeds.bbci.co.uk/arabic/rss.xml",
    "dw_ar": "https://rss.dw.com/rdf/rss-ar-all",
    "aljazeera": "https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9",
    "un_news_ar": "https://news.un.org/feed/subscribe/ar/news/all/rss.xml",
    "skynews_ar": "https://www.skynewsarabia.com/rss",
    "independent_ar": "https://www.independentarabia.com/rss.xml",
    "cnn_ar": "https://arabic.cnn.com/api/v1/rss/rss.xml",
    "france24_ar": "https://www.france24.com/ar/rss",
    "euronews_ar": "https://arabic.euronews.com/rss",
}
TOPICS = ["moon", "river", "desert", "mountain", "market", "mosque", "city", "horse", "camel", "bird", "flower",
          "ocean", "forest", "bridge", "castle", "garden", "child", "music", "book", "tree", "rain", "snow",
          "sun", "star", "galaxy", "rocket", "earth", "volcano", "lake", "boat", "train", "street", "house",
          "cat", "dog", "fish", "fruit", "bread", "coffee", "tea", "lamp", "clock", "map", "calligraphy",
          "pottery", "textile", "carpet", "portrait", "landscape", "sculpture", "architecture", "palm",
          "olive", "wheat", "lion", "eagle", "butterfly", "insect", "planet", "storm", "cloud", "harbor"]
NASA_TOPICS = ["moon", "mars", "earth", "rocket", "launch", "astronaut", "galaxy", "nebula", "sun", "planet",
               "saturn", "jupiter", "comet", "aurora", "hurricane", "satellite", "space station", "telescope",
               "volcano", "ocean", "desert", "glacier", "clouds", "aircraft", "rover", "eclipse", "star"]
ARABIC_LETTERS = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي"


class Frontier:
    """Titles discovered by following links / news search (the 'web' part)."""

    def __init__(self, cap: int = 5000):
        self.q = deque(maxlen=cap)
        self.lock = threading.Lock()

    def push(self, titles):
        with self.lock:
            for t in titles:
                self.q.append(t)

    def pop(self, rng):
        with self.lock:
            if not self.q:
                return None
            i = rng.randrange(len(self.q))
            self.q.rotate(-i)
            return self.q.popleft()


FRONTIER = Frontier()


def src_wiki(name):
    api = WIKI_PROJECTS[name]
    main = name == "wiki_ar"

    def run(rng):
        params = {"action": "query", "format": "json", "prop": "extracts" + ("|pageimages|links" if main else ""),
                  "explaintext": 1, "redirects": 1}
        if main:
            params.update({"piprop": "thumbnail", "pithumbsize": 256, "pllimit": 40, "plnamespace": 0})
        title = FRONTIER.pop(rng) if main and rng.random() < 0.6 else None
        if title:
            params["titles"] = title
        else:
            params.update({"generator": "random", "grnnamespace": 0, "grnlimit": 1})
        j = get_json(api, params)
        out = []
        for p in ((j or {}).get("query", {}).get("pages", {}) or {}).values():
            text = clean(p.get("extract", ""))
            if len(text) >= 200:
                out.append(Item("text", f"{p.get('title', '')}\n{text[:12000]}", name, license="CC BY-SA"))
            if main:
                FRONTIER.push(l["title"] for l in p.get("links", []) if ":" not in l["title"])
                thumb = (p.get("thumbnail") or {}).get("source")
                if thumb and len(text) > 40:
                    first = re.split(r"(?<=[.!؟?])\s", text, 1)[0][:300]
                    img = http_get(thumb, timeout=20, max_bytes=MAX_MEDIA_BYTES)
                    if img:
                        out.append(Item("image", f"{p.get('title', '')}: {first}", "wiki_ar_image", img, "CC/PD (Wikimedia)"))
        return out
    return run


_rss_last: dict[str, float] = {}
_rss_lock = threading.Lock()


def src_rss(rng):
    """One feed that has not been read for 15 minutes; headline + summary."""
    with _rss_lock:
        due = [n for n in RSS_FEEDS if time.time() - _rss_last.get(n, 0) > 900]
        if not due:
            return []
        name = rng.choice(due)
        _rss_last[name] = time.time()
    raw = http_get(RSS_FEEDS[name])
    if not raw:
        return []
    try:
        root = ET.fromstring(raw)
    except Exception:
        return []
    out = []
    for it in (e for e in root.iter() if e.tag.split("}")[-1] == "item"):
        f = {c.tag.split("}")[-1]: (c.text or "") for c in it}
        title, desc = clean(f.get("title", "")), clean(f.get("description", ""), 1500)
        if len(title) + len(desc) < 60:
            continue
        out.append(Item("text", f"{title}\n{desc}", f"rss:{name}", license="news summary"))
        words = [w for w in re.findall(r"[؀-ۿ]{4,}", title)][:3]
        if words and rng.random() < 0.3:  # news → background knowledge
            j = get_json(WIKI_PROJECTS["wiki_ar"], {"action": "query", "format": "json", "list": "search",
                                                   "srsearch": " ".join(words), "srlimit": 2})
            FRONTIER.push(s["title"] for s in (j or {}).get("query", {}).get("search", []))
        if NEWS_IMAGES:
            thumb = next((c.attrib.get("url") for c in it if c.tag.split("}")[-1] in ("thumbnail", "content")
                          and c.attrib.get("url")), None)
            img = http_get(thumb, max_bytes=MAX_MEDIA_BYTES) if thumb else None
            if img:
                out.append(Item("image", title, f"rss_image:{name}", img, "news photo"))
    return out


def _commons_license_ok(lic: str) -> bool:
    lic = (lic or "").lower()
    return any(k in lic for k in ("cc0", "public domain", "cc by", "cc-by", "pd")) and "nc" not in lic


def src_commons_images(rng):
    j = get_json(COMMONS, {"action": "query", "format": "json", "generator": "random", "grnnamespace": 6,
                           "grnlimit": 10, "prop": "imageinfo", "iiprop": "url|mime|extmetadata", "iiurlwidth": 320,
                           "iiextmetadatafilter": "ImageDescription|LicenseShortName|ObjectName"})
    out = []
    for p in ((j or {}).get("query", {}).get("pages", {}) or {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        em = ii.get("extmetadata", {})
        lic = em.get("LicenseShortName", {}).get("value", "")
        cap = clean(em.get("ImageDescription", {}).get("value", "") or em.get("ObjectName", {}).get("value", ""), 300)
        if ii.get("mime") not in ("image/jpeg", "image/png") or len(cap) < 15 or not _commons_license_ok(lic):
            continue
        img = http_get(ii.get("thumburl") or ii.get("url"), max_bytes=MAX_MEDIA_BYTES)
        if img:
            out.append(Item("image", cap, "commons_image", img, lic))
    return out


def src_nasa_images(rng):
    j = get_json("https://images-api.nasa.gov/search", {"q": rng.choice(NASA_TOPICS), "media_type": "image",
                                                          "page": rng.randint(1, 3)})
    items = (j or {}).get("collection", {}).get("items", [])
    out = []
    for it in rng.sample(items, min(4, len(items))):
        d = (it.get("data") or [{}])[0]
        link = next((l["href"] for l in it.get("links", []) if "~small" in l.get("href", "") or "~thumb" in l.get("href", "")), None)
        cap = clean(f"{d.get('title', '')}. {d.get('description', '')}", 300)
        img = http_get(link, max_bytes=MAX_MEDIA_BYTES) if link else None
        if img and len(cap) > 15:
            out.append(Item("image", cap, "nasa_image", img, "NASA (public domain)"))
    return out


def src_artic(rng):
    # the search endpoint filters to public-domain works (at most 1,000 results per query)
    j = get_json("https://api.artic.edu/api/v1/artworks/search",
                 {"q": rng.choice(TOPICS), "query[term][is_public_domain]": "true", "page": rng.randint(1, 5),
                  "limit": 10, "fields": "id,title,image_id,is_public_domain,artist_display,alt_text"})
    out = []
    for a in (j or {}).get("data", []):
        if not a.get("is_public_domain") or not a.get("image_id"):
            continue
        cap = clean(a.get("alt_text") or f"{a.get('title', '')} — {a.get('artist_display', '')}", 300)
        # the museum's image server asks bots to identify themselves with AIC-User-Agent
        img = http_get(f"https://www.artic.edu/iiif/2/{a['image_id']}/full/200,/0/default.jpg", max_bytes=MAX_MEDIA_BYTES,
                       headers={"AIC-User-Agent": UA})
        if img and len(cap) > 10:
            out.append(Item("image", cap, "artic", img, "CC0 (public domain)"))
        if len(out) >= 3:
            break
    return out


def src_met(rng):
    j = get_json("https://collectionapi.metmuseum.org/public/collection/v1/search",
                 {"hasImages": "true", "q": rng.choice(TOPICS)})
    ids = (j or {}).get("objectIDs") or []
    out = []
    for oid in rng.sample(ids, min(4, len(ids))):
        o = get_json(f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{oid}")
        if not o or not o.get("isPublicDomain") or not o.get("primaryImageSmall"):
            continue
        cap = clean(", ".join(x for x in (o.get("title"), o.get("objectName"), o.get("culture"), o.get("objectDate")) if x), 300)
        img = http_get(o["primaryImageSmall"], max_bytes=MAX_MEDIA_BYTES)
        if img:
            out.append(Item("image", cap, "met", img, "CC0 (public domain)"))
    return out


def src_openverse(rng):
    j = get_json("https://api.openverse.org/v1/images/", {"q": rng.choice(TOPICS), "page_size": 8,
                                                          "page": rng.randint(1, 20), "license_type": "commercial"})
    out = []
    for r in (j or {}).get("results", [])[:4]:
        cap = clean(r.get("title") or "", 200)
        tags = ", ".join(t.get("name", "") for t in (r.get("tags") or [])[:6])
        if tags:
            cap = f"{cap} ({tags})" if cap else tags
        img = http_get(r.get("thumbnail"), max_bytes=MAX_MEDIA_BYTES) if r.get("thumbnail") else None
        if img and len(cap) > 8:
            out.append(Item("image", cap, "openverse", img, r.get("license", "cc")))
    return out


def src_lingua_libre(rng):
    j = get_json(COMMONS, {"action": "query", "format": "json", "generator": "categorymembers",
                           "gcmtitle": "Category:Lingua Libre pronunciation-ara", "gcmtype": "file", "gcmlimit": 6,
                           "gcmsort": "sortkey", "gcmstartsortkeyprefix": rng.choice(ARABIC_LETTERS) + rng.choice(ARABIC_LETTERS),
                           "prop": "imageinfo", "iiprop": "url|mime|size"})
    out = []
    for p in ((j or {}).get("query", {}).get("pages", {}) or {}).values():
        m = re.match(r"File:LL-Q13955 \(ara\)-[^-]+-(.+)\.\w+$", p.get("title", ""))
        ii = (p.get("imageinfo") or [{}])[0]
        if not m or not ii.get("url"):
            continue
        audio = http_get(ii["url"], max_bytes=5 * 1024 * 1024)
        if audio:
            out.append(Item("audio", m.group(1).strip(), "lingua_libre", audio, "CC BY-SA (Lingua Libre)"))
    return out


def src_commons_video(rng):
    j = get_json(COMMONS, {"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6,
                           "gsrsearch": "filetype:video", "gsrlimit": 4, "gsroffset": rng.randint(0, 9900),
                           "prop": "videoinfo", "viprop": "url|mime|size|derivatives|extmetadata",
                           "viextmetadatafilter": "ImageDescription|LicenseShortName|ObjectName"})
    out = []
    for p in ((j or {}).get("query", {}).get("pages", {}) or {}).values():
        vi = (p.get("videoinfo") or [{}])[0]
        em = vi.get("extmetadata", {})
        lic = em.get("LicenseShortName", {}).get("value", "")
        cap = clean(em.get("ImageDescription", {}).get("value", "") or
                    re.sub(r"\.\w+$", "", p.get("title", "").replace("File:", "")).replace("_", " "), 300)
        ders = sorted((d for d in vi.get("derivatives", []) if d.get("transcodekey")), key=lambda d: d.get("width") or 9999)
        if not ders or not _commons_license_ok(lic) or len(cap) < 10:
            continue
        data = http_get(ders[0]["src"], timeout=60, max_bytes=MAX_MEDIA_BYTES)
        if data:
            out.append(Item("video", cap, "commons_video", data, lic))
    return out


def src_nasa_video(rng):
    j = get_json("https://images-api.nasa.gov/search", {"q": rng.choice(NASA_TOPICS), "media_type": "video",
                                                          "page": rng.randint(1, 3)})
    items = (j or {}).get("collection", {}).get("items", [])
    out = []
    for it in rng.sample(items, min(2, len(items))):
        d = (it.get("data") or [{}])[0]
        files = get_json(it.get("href", "")) or []
        small = next((f for f in files if f.endswith("~mobile.mp4")), None) or next((f for f in files if f.endswith("~small.mp4")), None)
        cap = clean(f"{d.get('title', '')}. {d.get('description', '')}", 300)
        data = http_get(small.replace("http://", "https://"), timeout=60, max_bytes=MAX_MEDIA_BYTES) if small else None
        if data and len(cap) > 10:
            out.append(Item("video", cap, "nasa_video", data, "NASA (public domain)"))
    return out


def src_mirror(kind: str, batch: int, workdir: Path, ledger_holder: dict):
    """The licensed sets the stages already use (sham_data_sources), a few
    at a time, as another strand of the web. Reads files it wrote itself."""
    def run(rng):
        from sham_data_sources import Ledger, collect

        ledger = ledger_holder.setdefault(kind, Ledger.load(kind, name=f"live_{kind}"))
        out_dir = workdir / f"mirror_{kind}_{int(time.time() * 1000)}"
        manifest, stats = collect(kind, out_dir, batch, ledger, image_size=256, num_frames=8)
        root = Path(manifest).parent
        items = []
        for line in open(manifest, encoding="utf-8"):
            rec = json.loads(line)
            if kind == "image":
                items.append(Item("image", rec["caption"], f"mirror_{kind}", (root / rec["image"]).read_bytes()))
            elif kind == "audio":
                items.append(Item("audio", rec["sentence"], f"mirror_{kind}", (root / rec["audio"]).read_bytes()))
            else:
                frames = [(root / f).read_bytes() for f in rec["frames"]]
                wav = (root / rec["audio"]).read_bytes() if rec.get("audio") else None
                items.append(Item("video", rec["caption"], f"mirror_{kind}",
                                  json.dumps({"frames": [f.hex() for f in frames], "wav": wav.hex() if wav else None}).encode()))
        import shutil
        shutil.rmtree(out_dir, ignore_errors=True)
        return items
    return run


# ---------------------------------------------------------------- the network

@dataclass
class SourceState:
    name: str
    kind: str
    fn: object
    ok: int = 0
    fail: int = 0
    items: int = 0
    streak: int = 0
    rest_until: float = 0.0
    recent: deque = field(default_factory=lambda: deque(maxlen=20))  # (items, seconds)

    def score(self) -> float:
        recent = list(self.recent)  # snapshot: other workers append concurrently
        if not recent:
            return 1.0  # untried: give it a chance
        n = sum(i for i, _ in recent)
        s = sum(t for _, t in recent) or 1.0
        return 0.05 + n / s


def default_sources(workdir: Path, ledgers: dict, mirrors: bool = True, video: bool = True):
    s = [SourceState(n, "text", src_wiki(n)) for n in WIKI_PROJECTS]
    s += [SourceState("rss", "text", src_rss),
          SourceState("commons_image", "image", src_commons_images), SourceState("nasa_image", "image", src_nasa_images),
          SourceState("artic", "image", src_artic), SourceState("met", "image", src_met),
          SourceState("openverse", "image", src_openverse), SourceState("lingua_libre", "audio", src_lingua_libre)]
    if video:
        s += [SourceState("commons_video", "video", src_commons_video), SourceState("nasa_video", "video", src_nasa_video)]
    if mirrors:
        s += [SourceState("mirror_image", "image", src_mirror("image", 32, workdir, ledgers)),
              SourceState("mirror_audio", "audio", src_mirror("audio", 32, workdir, ledgers))]
        if video:
            s.append(SourceState("mirror_video", "video", src_mirror("video", 2, workdir, ledgers)))
    return s


class Spider:
    """Worker threads that keep `out` (a Queue of Item) full."""

    def __init__(self, sources, seen: Seen, out: queue.Queue, targets: dict, workers: int = 12, seed: int = 0):
        self.sources, self.seen, self.out, self.targets = sources, seen, out, targets
        self.workers, self.seed = workers, seed
        self.emitted = {k: 0 for k in targets}
        self.dups = 0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self.threads = []

    def _pick(self, rng):
        now = time.time()
        live = [s for s in self.sources if s.rest_until <= now]
        if not live:
            return None
        total = sum(self.emitted.values()) or 1
        kinds = {s.kind for s in live}
        # the modality furthest below its target share
        kind = min(kinds, key=lambda k: self.emitted.get(k, 0) / total - self.targets.get(k, 0) + rng.random() * 0.02)
        pool = [s for s in live if s.kind == kind]
        weights = [s.score() for s in pool]
        return rng.choices(pool, weights)[0]

    def _work(self, idx):
        rng = random.Random(self.seed * 1000 + idx)
        while not self._stop.is_set():
            try:
                self._step(rng)
            except Exception:  # a worker never dies
                time.sleep(1.0)

    def _step(self, rng):
        src = self._pick(rng)
        if src is None:
            time.sleep(1.0)
            return
        t0 = time.time()
        try:
            items = src.fn(rng) or []
            src.ok += 1
        except Exception:
            items = []
            src.fail += 1
        # nothing came back (error, rate limit, empty page): count toward a rest
        src.streak = 0 if items else src.streak + 1
        if src.streak >= 5:  # rest a failing source, longer each time
            src.rest_until = time.time() + min(60 * 2 ** (src.streak - 5), 3600)
        new = 0
        for it in items:
            it.key = it.key or fingerprint(it.kind, it.text, it.data)
            if not self.seen.add_new(it.key):
                with self._lock:
                    self.dups += 1
                continue
            while not self._stop.is_set():
                try:
                    self.out.put(it, timeout=2)
                    break
                except queue.Full:
                    pass
            new += 1
            with self._lock:
                self.emitted[it.kind] = self.emitted.get(it.kind, 0) + 1
        src.items += new
        src.recent.append((new, max(time.time() - t0, 0.05)))
        if not new:
            time.sleep(0.2)

    def start(self):
        for i in range(self.workers):
            t = threading.Thread(target=self._work, args=(i,), daemon=True)
            t.start()
            self.threads.append(t)
        return self

    def stop(self):
        self._stop.set()

    def report(self) -> str:
        rows = sorted(self.sources, key=lambda s: -s.items)
        parts = [f"{s.name}:{s.items}" + ("(راحة)" if s.rest_until > time.time() else "") for s in rows if s.ok or s.fail]
        return (f"🕸 الشبكة: " + " | ".join(f"{k} {v:,}" for k, v in self.emitted.items())
                + f" | مكرر مُستبعد {self.dups:,}\n   المصادر: " + ", ".join(parts))


if __name__ == "__main__":
    # offline test: network logic with fake sources (no internet needed)
    q = queue.Queue(maxsize=100)
    calls = {"n": 0}

    def fake_text(rng):
        calls["n"] += 1
        return [Item("text", f"مقال رقم {rng.randint(0, 5)}", "fake")]

    def fake_img(rng):
        return [Item("image", "صورة", "fake_img", bytes([rng.randint(0, 255)]) * 100)]

    def broken(rng):
        raise RuntimeError("down")

    srcs = [SourceState("t", "text", fake_text), SourceState("i", "image", fake_img), SourceState("b", "audio", broken)]
    sp = Spider(srcs, Seen(), q, {"text": 0.5, "image": 0.4, "audio": 0.1}, workers=3).start()
    time.sleep(1.0)
    sp.stop()
    got = []
    while not q.empty():
        got.append(q.get())
    keys = [g.key for g in got]
    assert len(keys) == len(set(keys)), "duplicates emitted"
    assert {g.kind for g in got} == {"text", "image"}
    assert srcs[2].rest_until > time.time(), "failing source not rested"
    assert sp.dups > 0
    assert clean("<p>مرحبا&amp; <b>شام</b>‏</p>") == "مرحبا& شام"
    print(sp.report())
    print("sham_spider self-test OK")
