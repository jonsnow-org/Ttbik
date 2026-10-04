"""
Sources for the GitHub-hosted collection (the free GitHub Actions runner) — deliberately NOT the ones the
Kaggle live trainer already reads (the Wikipedia family, the news feeds, NASA/Commons/Met/Art-Institute/Openverse
pictures, Lingua Libre, the HF mirror sets). Nothing here is tied to a language or a direction: books in many
languages, scientific papers, questions and answers, code with its documentation, discussions, museum and archive
pictures, public-domain recordings and films — each source returns `sham_spider.Item`s, so the same Spider (pacing,
back-off, URL memory, fingerprints) drives them.

  text   gutenberg      Project Gutenberg books (public domain, ~70 languages), random passages
         ia_books       Internet Archive books published before 1929 (public domain), OCR text, 10+ languages
         arxiv          arXiv abstracts (physics, mathematics, computer science, biology, economics, statistics)
         europepmc      Europe PMC open-access biomedical abstracts
         crossref       Crossref abstracts of scholarly works (random sample)
         hackernews     Hacker News comments and stories (technical discussion)
         stackexchange  Questions with their top answers from many Stack Exchange sites and languages
         github         Source code + READMEs from permissively licensed repositories (needs GITHUB_TOKEN to go fast)
  image  loc            Library of Congress prints and photographs (with their titles)
         cleveland      Cleveland Museum of Art open-access works (CC0)
         ia_images      Internet Archive images (Flickr Commons and other public collections)
  audio  librivox       LibriVox public-domain audiobooks (a ~20-second slice from a random point of a random chapter)
         ia_audio       Internet Archive audio under Creative Commons / public domain
  video  ia_video       Internet Archive films (Prelinger and Creative-Commons/public-domain uploads), small derivatives

Each source is a function `fn(rng) -> list[Item]`; a failure returns [] (the Spider rests a source that keeps failing).
"""

from __future__ import annotations

import csv
import io
import json
import os
import random
import re
import threading
import urllib.parse
import xml.etree.ElementTree as ET

from sham_spider import MAX_MEDIA_BYTES, PACER, Item, SourceState, clean, get_json, http_get, new_url

PACER.gaps.update({"export.arxiv.org": 3.2, "archive.org": 0.6, "api.stackexchange.com": 1.5, "api.github.com": 2.1,
                   "raw.githubusercontent.com": 0.2, "www.gutenberg.org": 1.0, "api.crossref.org": 1.0,
                   "www.ebi.ac.uk": 0.6, "hacker-news.firebaseio.com": 0.05, "www.loc.gov": 3.0, "tile.loc.gov": 0.5,
                   "openaccess-api.clevelandart.org": 0.5, "librivox.org": 1.0, "openaccess-cdn.clevelandart.org": 0.3})
LICENSES = ["mit", "apache-2.0", "bsd-3-clause", "bsd-2-clause", "mpl-2.0", "unlicense", "cc0-1.0", "isc"]


def passage(text: str, rng: random.Random, n: int = 6000) -> str:
    """A random contiguous passage of about n characters, cut at paragraph/sentence edges."""
    text = text.strip()
    if len(text) <= n:
        return text
    start = rng.randrange(0, len(text) - n)
    cut = text.find("\n\n", start, start + 800)
    start = cut + 2 if cut != -1 else start
    seg = text[start:start + n]
    end = max(seg.rfind("\n\n"), seg.rfind(". "), seg.rfind("۔"), seg.rfind("。"))
    return seg[:end + 1].strip() if end > n // 2 else seg.strip()


# ---------------------------------------------------------------- text

_PG: dict = {"rows": None, "lock": threading.Lock()}


def _gutenberg_catalog():
    with _PG["lock"]:
        if _PG["rows"] is None:
            raw = http_get("https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv", timeout=90, max_bytes=60_000_000)
            rows = []
            if raw:
                for r in csv.DictReader(io.StringIO(raw.decode("utf-8", "ignore"))):
                    if r.get("Type") == "Text" and r.get("Text#", "").isdigit():
                        rows.append((int(r["Text#"]), r.get("Language", "en"), r.get("Title", ""), r.get("Authors", "")))
            _PG["rows"] = rows
    return _PG["rows"]


def src_gutenberg(rng):
    rows = _gutenberg_catalog()
    bid, lang, title, author = rng.choice(rows) if rows else (rng.randint(1, 74000), "?", "", "")
    if not new_url("gutenberg", str(bid)):
        return []
    raw = http_get(f"https://www.gutenberg.org/cache/epub/{bid}/pg{bid}.txt", timeout=60, max_bytes=6_000_000)
    if not raw:
        return []
    text = raw.decode("utf-8", "ignore")
    a = re.search(r"\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n", text)
    b = text.rfind("*** END OF")
    body = text[a.end():b if b > 0 else None] if a else text
    if len(body) < 3000:
        return []
    return [Item("text", f"{title} — {author}\n\n{passage(body, rng, 7000)}", "gutenberg", license="Public domain")
            for _ in range(2)]


IA_LANGS = ["ara", "fre", "ger", "spa", "chi", "rus", "jpn", "hin", "tur", "per", "ita", "por", "urd", "heb", "kor", "dut"]


def _ia_search(query: str, rng, rows: int = 10, pages: int = 100, fields=("identifier", "title", "description", "language")):
    p = {"q": query, "rows": rows, "page": rng.randint(1, pages), "output": "json"}
    p["fl[]"] = list(fields)
    j = get_json("https://archive.org/advancedsearch.php", p, timeout=40)
    return (j or {}).get("response", {}).get("docs", [])


def src_ia_books(rng):
    lang = rng.choice(IA_LANGS)
    docs = _ia_search(f"mediatype:texts AND language:{lang} AND date:[1000-01-01 TO 1928-12-31] "
                      f"AND -access-restricted-item:true", rng)
    out = []
    for d in rng.sample(docs, min(2, len(docs))):
        ident = d["identifier"]
        if not new_url("ia_book", ident):
            continue
        raw = http_get(f"https://archive.org/download/{ident}/{ident}_djvu.txt", timeout=80, max_bytes=8_000_000)
        if not raw:
            continue
        text = raw.decode("utf-8", "ignore")
        if len(text) < 3000:
            continue
        out.append(Item("text", f"{clean(str(d.get('title', '')), 200)}\n\n{passage(text, rng, 7000)}", "ia_books",
                        license="Public domain (pre-1929)"))
    return out


ARXIV_CATS = ["physics.gen-ph", "astro-ph.GA", "astro-ph.EP", "cond-mat.mtrl-sci", "quant-ph", "hep-th", "math.NT", "math.AG",
              "math.PR", "math.CO", "math.AP", "cs.CL", "cs.LG", "cs.CV", "cs.CR", "cs.DS", "cs.PL", "cs.SE", "q-bio.NC",
              "q-bio.PE", "q-bio.GN", "econ.GN", "stat.ME", "stat.ML", "eess.SP", "nlin.CD", "physics.chem-ph", "physics.bio-ph"]


def src_arxiv(rng):
    cat = rng.choice(ARXIV_CATS)
    raw = http_get("https://export.arxiv.org/api/query", {"search_query": f"cat:{cat}", "start": rng.randint(0, 6000),
                                                          "max_results": 20, "sortBy": "submittedDate"}, timeout=40)
    out = []
    if not raw:
        return out
    ns = {"a": "http://www.w3.org/2005/Atom"}
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return out
    for e in root.findall("a:entry", ns):
        ident = (e.findtext("a:id", "", ns) or "").strip()
        title = clean(e.findtext("a:title", "", ns))
        abstract = clean(e.findtext("a:summary", "", ns))
        if len(abstract) < 200 or not new_url("arxiv", ident):
            continue
        out.append(Item("text", f"{title}\n\n{abstract}", "arxiv", license="arXiv (abstract)"))
    return out


EPMC_TERMS = ["protein", "cancer", "ecology", "neuroscience", "virus", "genome", "climate", "diabetes", "microbiome", "plant",
              "malaria", "vaccine", "epidemiology", "cardiology", "pediatrics", "oncology", "biodiversity", "soil", "marine"]


def src_europepmc(rng):
    j = get_json("https://www.ebi.ac.uk/europepmc/webservices/rest/search",
                 {"query": f"({rng.choice(EPMC_TERMS)}) AND OPEN_ACCESS:y AND HAS_ABSTRACT:y", "format": "json",
                  "pageSize": 25, "resultType": "core", "page": rng.randint(1, 300)}, timeout=40)
    out = []
    for r in ((j or {}).get("resultList", {}) or {}).get("result", []):
        ab = clean(r.get("abstractText", ""))
        if len(ab) < 300 or not new_url("epmc", str(r.get("id", r.get("pmid", "")))):
            continue
        out.append(Item("text", f"{clean(r.get('title', ''))}\n\n{ab}", "europepmc", license="Open access (Europe PMC)"))
    return out


def src_crossref(rng):
    j = get_json("https://api.crossref.org/works", {"sample": 25, "filter": "has-abstract:true",
                                                    "select": "DOI,title,abstract,container-title"}, timeout=40)
    out = []
    for w in ((j or {}).get("message", {}) or {}).get("items", []):
        ab = clean(w.get("abstract", ""))
        if len(ab) < 300 or not new_url("crossref", w.get("DOI", "")):
            continue
        title = clean((w.get("title") or [""])[0])
        venue = clean((w.get("container-title") or [""])[0])
        out.append(Item("text", f"{title}" + (f" ({venue})" if venue else "") + f"\n\n{ab}", "crossref", license="Crossref metadata"))
    return out


_HN: dict = {"max": None}


def src_hackernews(rng):
    if _HN["max"] is None:
        _HN["max"] = int(get_json("https://hacker-news.firebaseio.com/v0/maxitem.json") or 0) or 40_000_000
    out = []
    for _ in range(14):
        it = get_json(f"https://hacker-news.firebaseio.com/v0/item/{rng.randint(1, _HN['max'])}.json") or {}
        text = clean(it.get("text", ""))
        if it.get("deleted") or it.get("dead") or len(text) < 350 or it.get("type") not in ("comment", "story"):
            continue
        if new_url("hn", str(it.get("id"))):
            title = clean(it.get("title", ""))
            out.append(Item("text", (title + "\n\n" if title else "") + text, "hackernews", license="Hacker News (public)"))
    return out


SE_SITES = ["stackoverflow", "math", "physics", "chemistry", "biology", "philosophy", "academia", "english", "history",
            "astronomy", "electronics", "unix", "askubuntu", "stats", "cs", "ru.stackoverflow", "es.stackoverflow",
            "pt.stackoverflow", "ja.stackoverflow", "german", "french", "arabic", "islam", "travel", "cooking", "law"]
_SE: dict = {"rest": 0.0}


def src_stackexchange(rng):
    import time
    if _SE["rest"] > time.time():
        return []
    site = rng.choice(SE_SITES)
    q = get_json("https://api.stackexchange.com/2.3/questions",
                 {"site": site, "pagesize": 25, "page": rng.randint(1, 60), "order": "desc", "sort": "votes",
                  "filter": "withbody"}, timeout=40) or {}
    if q.get("quota_remaining", 99) < 5:
        _SE["rest"] = time.time() + 3600
    qs = [x for x in q.get("items", []) if x.get("is_answered") and x.get("accepted_answer_id")]
    if not qs:
        return []
    pick = rng.sample(qs, min(5, len(qs)))
    ids = ";".join(str(x["accepted_answer_id"]) for x in pick)
    a = get_json(f"https://api.stackexchange.com/2.3/answers/{ids}", {"site": site, "filter": "withbody"}, timeout=40) or {}
    answers = {x["answer_id"]: clean(x.get("body", "")) for x in a.get("items", [])}
    out = []
    for x in pick:
        ans = answers.get(x["accepted_answer_id"], "")
        body = clean(x.get("body", ""))
        if len(ans) < 80 or not new_url("se", f"{site}:{x['question_id']}"):
            continue
        out.append(Item("text", f"{clean(x.get('title', ''))}\n\n{body[:4000]}\n\n{ans[:4000]}", f"se_{site}",
                        license="CC BY-SA (Stack Exchange)"))
    return out


GH_LANGS = {"python": (".py",), "javascript": (".js", ".mjs"), "typescript": (".ts",), "java": (".java",), "c": (".c", ".h"),
            "c++": (".cpp", ".hpp", ".cc"), "go": (".go",), "rust": (".rs",), "ruby": (".rb",), "php": (".php",),
            "swift": (".swift",), "kotlin": (".kt",), "shell": (".sh",), "haskell": (".hs",), "lua": (".lua",),
            "julia": (".jl",), "r": (".r", ".R"), "scala": (".scala",), "c#": (".cs",), "sql": (".sql",),
            "dart": (".dart",), "elixir": (".ex",), "ocaml": (".ml",), "tex": (".tex",)}


def _gh_headers():
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


def src_github(rng):
    lang = rng.choice(list(GH_LANGS))
    q = f'language:"{lang}" license:{rng.choice(LICENSES)} stars:{rng.choice(["5..50", "50..500", "500..5000"])} fork:false'
    raw = http_get("https://api.github.com/search/repositories",
                   {"q": q, "per_page": 15, "page": rng.randint(1, 10), "sort": rng.choice(["updated", "stars"])},
                   timeout=40, headers=_gh_headers())
    try:
        repos = json.loads(raw).get("items", []) if raw else []
    except Exception:
        repos = []
    if not repos:
        return []
    repo = rng.choice(repos)
    full, branch = repo["full_name"], repo.get("default_branch", "main")
    lic = (repo.get("license") or {}).get("spdx_id", "")
    if not new_url("gh_repo", full):
        return []
    raw = http_get(f"https://api.github.com/repos/{full}/git/trees/{branch}", {"recursive": 1}, timeout=40, headers=_gh_headers())
    try:
        tree = json.loads(raw).get("tree", []) if raw else []
    except Exception:
        tree = []
    exts = GH_LANGS[lang]
    code = [t for t in tree if t.get("type") == "blob" and t["path"].endswith(exts) and 600 <= t.get("size", 0) <= 60_000
            and not re.search(r"(^|/)(test|tests|vendor|node_modules|dist|build|third_party)(/|$)", t["path"])]
    docs = [t for t in tree if t.get("type") == "blob" and t.get("size", 0) >= 400
            and re.match(r"(?i)(readme[^/]*\.(md|rst|txt)|docs/.+\.(md|rst))$", t["path"])][:2]
    out = []
    for t in docs[:1] + rng.sample(code, min(3, len(code))):
        data = http_get(f"https://raw.githubusercontent.com/{full}/{branch}/{urllib.parse.quote(t['path'])}", timeout=40,
                        max_bytes=200_000)
        if not data:
            continue
        text = data.decode("utf-8", "ignore").strip()
        if len(text) >= 400:
            out.append(Item("text", f"# {full}/{t['path']}\n{text[:12000]}", f"github_{lang}", license=lic or "permissive"))
    return out


# ---------------------------------------------------------------- images

LOC_TOPICS = ["map", "portrait", "street", "ship", "bridge", "architecture", "farm", "train", "market", "flower", "bird",
              "landscape", "dress", "tool", "instrument", "school", "harbor", "factory", "poster", "cartoon"]


def src_loc(rng):
    j = get_json("https://www.loc.gov/pictures/search/", {"q": rng.choice(LOC_TOPICS), "fo": "json", "c": 25,
                                                           "sp": rng.randint(1, 60)}, timeout=40)
    out = []
    for r in ((j or {}).get("results") or []):
        url = (r.get("image") or {}).get("full")
        title = clean(str(r.get("title", "")), 300)
        if not url or len(title) < 8 or not new_url("loc", url):
            continue
        img = http_get(url if url.startswith("http") else "https:" + url, max_bytes=MAX_MEDIA_BYTES)
        if img:
            out.append(Item("image", title, "loc", img, "Library of Congress (no known restrictions)"))
    return out


def src_cleveland(rng):
    j = get_json("https://openaccess-api.clevelandart.org/api/artworks/",
                 {"has_image": 1, "limit": 8, "skip": rng.randint(0, 28000), "cc0": 1}, timeout=40)
    out = []
    for a in ((j or {}).get("data") or []):
        url = ((a.get("images") or {}).get("web") or {}).get("url")
        cap = clean(f"{a.get('title', '')}. {a.get('creation_date', '')}. {a.get('culture') and ', '.join(a['culture']) or ''}. "
                    f"{a.get('technique', '') or ''}. {a.get('tombstone', '') or ''}", 320)
        if not url or len(cap) < 8 or not new_url("cleveland", url):
            continue
        img = http_get(url, max_bytes=MAX_MEDIA_BYTES)
        if img:
            out.append(Item("image", cap, "cleveland", img, "CC0 (Cleveland Museum of Art)"))
    return out


def src_ia_images(rng):
    docs = _ia_search("mediatype:image AND (collection:flickrcommons OR collection:library_of_congress "
                      "OR collection:brooklynmuseum OR collection:smithsonian_libraries)", rng, rows=12, pages=60,
                      fields=("identifier", "title", "description"))
    out = []
    for d in docs:
        cap = clean(f"{d.get('title', '')}. {d.get('description', '') if isinstance(d.get('description'), str) else ''}", 320)
        ident = d["identifier"]
        if len(cap) < 8 or not new_url("ia_image", ident):
            continue
        img = http_get(f"https://archive.org/services/img/{ident}", max_bytes=MAX_MEDIA_BYTES)
        if img:
            out.append(Item("image", cap, "ia_images", img, "Internet Archive (public collection)"))
    return out


# ---------------------------------------------------------------- audio / video

def range_get(url: str, start: int, nbytes: int, timeout: float = 40) -> bytes | None:
    """A slice of a file (HTTP Range) — a recording is never downloaded whole just to use 20 seconds."""
    from sham_spider import _session
    host = urllib.parse.urlparse(url).netloc
    PACER.wait(host)
    try:
        with _session().get(url, headers={"Range": f"bytes={start}-{start + nbytes - 1}"}, timeout=timeout, stream=True) as r:
            if r.status_code not in (200, 206):
                return None
            buf = io.BytesIO()
            for chunk in r.iter_content(1 << 16):
                buf.write(chunk)
                if buf.tell() >= nbytes:
                    break
            return buf.getvalue()
    except Exception:
        PACER.penalize(host, 2.0)
        return None


def src_librivox(rng):
    j = get_json("https://librivox.org/api/feed/audiobooks/", {"format": "json", "limit": 5, "offset": rng.randint(0, 16000),
                                                               "extended": 1}, timeout=40)
    out = []
    for b in ((j or {}).get("books") or []):
        secs = [s for s in b.get("sections", []) if s.get("listen_url")]
        if not secs:
            continue
        s = rng.choice(secs)
        url = s["listen_url"].replace("http://", "https://")
        if not new_url("librivox", url):
            continue
        data = range_get(url, rng.randint(200_000, 6_000_000), 160_000)   # 64 kbps mp3 → ~20 s (the encoder uses 4 s)
        if data and len(data) > 60_000:
            author = " ".join(filter(None, [(b.get("authors") or [{}])[0].get("first_name"), (b.get("authors") or [{}])[0].get("last_name")]))
            cap = clean(f"{b.get('title', '')} — {author} ({b.get('language', '')}). {b.get('description', '')}", 260)
            out.append(Item("audio", cap, "librivox", data, "Public domain (LibriVox)"))
    return out


def _ia_files(ident: str):
    j = get_json(f"https://archive.org/metadata/{ident}", timeout=40) or {}
    return j.get("files", []), j.get("metadata", {})


def src_ia_audio(rng):
    docs = _ia_search("mediatype:audio AND (collection:librivoxaudio OR licenseurl:*creativecommons* OR licenseurl:*publicdomain*)",
                      rng, rows=8, pages=200, fields=("identifier", "title", "description"))
    out = []
    for d in docs[:3]:
        ident = d["identifier"]
        if not new_url("ia_audio", ident):
            continue
        files, meta = _ia_files(ident)
        mp3 = [f for f in files if f.get("name", "").lower().endswith((".mp3", ".ogg", ".flac")) and int(f.get("size", 0) or 0) > 150_000]
        if not mp3:
            continue
        f = rng.choice(mp3)
        size = int(f["size"])
        data = range_get(f"https://archive.org/download/{ident}/{urllib.parse.quote(f['name'])}",
                         rng.randint(0, max(0, size - 160_000)), 160_000)
        cap = clean(f"{d.get('title', '')}. {d.get('description', '') if isinstance(d.get('description'), str) else ''}", 260)
        if data and len(cap) >= 5:
            out.append(Item("audio", cap, "ia_audio", data, "Internet Archive (CC/public domain)"))
    return out


def src_ia_video(rng):
    docs = _ia_search("mediatype:movies AND (collection:prelinger OR licenseurl:*publicdomain* OR licenseurl:*zero*)",
                      rng, rows=8, pages=300, fields=("identifier", "title", "description"))
    out = []
    for d in docs[:3]:
        ident = d["identifier"]
        if not new_url("ia_video", ident):
            continue
        files, _ = _ia_files(ident)
        small = [f for f in files if f.get("name", "").lower().endswith(".mp4") and 300_000 < int(f.get("size", 0) or 0) < MAX_MEDIA_BYTES]
        cap = clean(f"{d.get('title', '')}. {d.get('description', '') if isinstance(d.get('description'), str) else ''}", 300)
        if not small or len(cap) < 5:
            continue
        f = min(small, key=lambda x: int(x["size"]))
        data = http_get(f"https://archive.org/download/{ident}/{urllib.parse.quote(f['name'])}", timeout=90, max_bytes=MAX_MEDIA_BYTES)
        if data:
            out.append(Item("video", cap, "ia_video", data, "Internet Archive (public domain/CC)"))
    return out


# ---------------------------------------------------------------- registry

def gh_sources(text_only: bool = False):
    s = [SourceState("gutenberg", "text", src_gutenberg), SourceState("ia_books", "text", src_ia_books),
         SourceState("arxiv", "text", src_arxiv), SourceState("europepmc", "text", src_europepmc),
         SourceState("crossref", "text", src_crossref), SourceState("hackernews", "text", src_hackernews),
         SourceState("stackexchange", "text", src_stackexchange), SourceState("github", "text", src_github)]
    if not text_only:
        s += [SourceState("loc", "image", src_loc), SourceState("cleveland", "image", src_cleveland),
              SourceState("ia_images", "image", src_ia_images), SourceState("librivox", "audio", src_librivox),
              SourceState("ia_audio", "audio", src_ia_audio), SourceState("ia_video", "video", src_ia_video)]
    return s


if __name__ == "__main__":
    import sys
    import time

    rng = random.Random(7)
    assert passage("a" * 100, rng, 6000) == "a" * 100
    long = "\n\n".join(f"Paragraph {i}. " + "word " * 60 for i in range(400))
    seg = passage(long, rng, 3000)
    assert 1500 < len(seg) <= 3000, len(seg)
    names = [s.name for s in gh_sources()]
    assert len(names) == len(set(names)) == 14, names
    only = {s.kind for s in gh_sources(text_only=True)}
    assert only == {"text"}

    if "--live" in sys.argv:   # one call of every source against the real services (needs internet)
        which = [a for a in sys.argv[2:]] or names
        for s in gh_sources():
            if s.name not in which:
                continue
            t0 = time.time()
            try:
                items = s.fn(random.Random(int(time.time()) % 1000))
            except Exception as exc:
                items = []
                print(f"{s.name:14s} EXCEPTION {type(exc).__name__}: {exc}")
            sizes = [len(i.data) if i.data else len(i.text) for i in items]
            print(f"{s.name:14s} {len(items):2d} items  {sum(sizes)//1024:6d} KB  {time.time()-t0:5.1f}s  "
                  f"e.g. {items[0].text[:70]!r}" if items else f"{s.name:14s}  0 items  {time.time()-t0:5.1f}s")
    print("sham_sources_gh self-test OK")
