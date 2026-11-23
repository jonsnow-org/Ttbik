"""A real, confined executor for file work: create / read / edit / convert documents, spreadsheets, slides, PDFs, images, audio, video, archives and data files.
Everything happens inside ONE workspace root; programs run as argument lists (never a shell) with a timeout. This is the reference implementation the tool
registry (`tools.py`, group `files`) describes: the model asks, `validate()` approves, and this runs it. A format whose library or program is missing says so
(`capabilities()`), it never pretends."""
from __future__ import annotations

import csv
import io
import json
import os
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path

MAX_BYTES = 200 * 1024 * 1024            # a single file this workspace will read or write
TIMEOUT = 120


class FileError(Exception):
    pass


def _lib(name: str):
    try:
        return __import__(name)
    except ImportError:
        raise FileError(f"{name} is not installed on this computer") from None


def capabilities() -> dict[str, bool]:
    """What this computer can do right now, honestly."""
    def has(m: str) -> bool:
        try:
            __import__(m)
            return True
        except ImportError:
            return False
    return {"docx": has("docx"), "xlsx": has("openpyxl"), "pptx": has("pptx"), "pdf_edit": has("pypdf"), "pdf_create": has("reportlab"), "image": has("PIL"),
            "yaml": has("yaml"), "pandoc": bool(shutil.which("pandoc")), "libreoffice": bool(shutil.which("soffice")), "ffmpeg": bool(shutil.which("ffmpeg"))}


class Workspace:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, rel: str, must_exist: bool = False) -> Path:
        if not isinstance(rel, str) or not rel or "\x00" in rel or rel.startswith(("/", "~")):
            raise FileError("path must be relative to the workspace")
        p = (self.root / rel).resolve()
        if p != self.root and self.root not in p.parents:
            raise FileError("path leaves the workspace")
        if must_exist and not p.exists():
            raise FileError(f"{rel}: no such file")
        return p

    def _run(self, args: list[str], timeout: int = TIMEOUT) -> str:
        if not shutil.which(args[0]):
            raise FileError(f"{args[0]} is not installed on this computer")
        try:
            r = subprocess.run(args, cwd=self.root, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL, env={"PATH": os.environ.get("PATH", ""), "HOME": str(self.root), "LANG": "C.UTF-8"})
        except subprocess.TimeoutExpired:
            raise FileError(f"{args[0]} timed out") from None
        if r.returncode:
            raise FileError(f"{args[0]} failed: {(r.stderr or r.stdout).strip()[-400:]}")
        return r.stdout

    def info(self, rel: str) -> dict:
        p = self.path(rel, True)
        st = p.stat()
        return {"path": rel, "bytes": st.st_size, "kind": p.suffix.lower().lstrip(".") or "file", "is_dir": p.is_dir()}

    # ------------------------------------------------------------------ text and data
    def read_text(self, rel: str, start: int = 1, lines: int = 200) -> str:
        p = self.path(rel, True)
        if p.stat().st_size > MAX_BYTES:
            raise FileError("file too large")
        rows = p.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(f"{i}\t{t}" for i, t in enumerate(rows[start - 1:start - 1 + lines], start))

    def write_text(self, rel: str, content: str) -> str:
        p = self.path(rel)
        if len(content.encode()) > MAX_BYTES:
            raise FileError("content too large")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"wrote {rel} ({p.stat().st_size} bytes)"

    def edit_text(self, rel: str, old: str, new: str) -> str:
        p = self.path(rel, True)
        text = p.read_text(encoding="utf-8")
        if text.count(old) != 1:
            raise FileError(f"old text must occur exactly once (found {text.count(old)})")
        p.write_text(text.replace(old, new), encoding="utf-8")
        return f"edited {rel}"

    def data_transform(self, rel: str, op: str, expr: str = "", out: str = "") -> str:
        """to_json | to_csv | to_yaml | query | set on csv / json / yaml / tsv. `expr`: a dotted path (a.b.0.c), for `set`: path=json-value."""
        p = self.path(rel, True)
        ext = p.suffix.lower().lstrip(".")
        raw = p.read_text(encoding="utf-8")
        if ext == "json":
            data = json.loads(raw)
        elif ext in ("csv", "tsv"):
            data = list(csv.DictReader(io.StringIO(raw), delimiter="\t" if ext == "tsv" else ","))
        elif ext in ("yaml", "yml"):
            data = _lib("yaml").safe_load(raw)
        else:
            raise FileError("data_transform reads json, csv, tsv, yaml")
        if op in ("query", "set"):
            keys = [k for k in expr.split("=", 1)[0].split(".") if k != ""]
            node = data
            walk = keys if op == "query" else keys[:-1]
            for k in walk:
                node = node[int(k)] if isinstance(node, list) else node[k]
            if op == "query":
                return json.dumps(node, ensure_ascii=False, indent=1)[:20000]
            value = json.loads(expr.split("=", 1)[1])
            last = keys[-1]
            if isinstance(node, list):
                node[int(last)] = value
            else:
                node[last] = value
            target = self.path(out) if out else p
            self._dump(target, data)
            return f"set {expr.split('=')[0]} in {out or rel}"
        if op not in ("to_json", "to_csv", "to_yaml") or not out:
            raise FileError("op must be to_json|to_csv|to_yaml|query|set; conversions need `out`")
        self._dump(self.path(out), data, {"to_json": "json", "to_csv": "csv", "to_yaml": "yaml"}[op])
        return f"wrote {out}"

    def _dump(self, target: Path, data, fmt: str | None = None) -> None:
        fmt = fmt or target.suffix.lower().lstrip(".")
        target.parent.mkdir(parents=True, exist_ok=True)
        if fmt == "json":
            target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        elif fmt in ("yaml", "yml"):
            target.write_text(_lib("yaml").safe_dump(data, allow_unicode=True), encoding="utf-8")
        elif fmt in ("csv", "tsv"):
            if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
                raise FileError("csv needs a list of records")
            cols = list(dict.fromkeys(k for r in data for k in r))
            buf = io.StringIO()
            w = csv.DictWriter(buf, cols, delimiter="\t" if fmt == "tsv" else ",")
            w.writeheader()
            w.writerows(data)
            target.write_text(buf.getvalue(), encoding="utf-8")
        else:
            raise FileError("unknown data format")

    # ------------------------------------------------------------------ Word
    def doc_create(self, rel: str, blocks: list) -> str:
        docx = _lib("docx")
        d = docx.Document()
        for b in blocks:
            t = b.get("type", "paragraph")
            if t == "heading":
                d.add_heading(b["text"], int(b.get("level", 1)))
            elif t == "paragraph":
                d.add_paragraph(b["text"])
            elif t == "list":
                for it in b["items"]:
                    d.add_paragraph(it, style="List Number" if b.get("ordered") else "List Bullet")
            elif t == "table":
                rows = b["rows"]
                tb = d.add_table(rows=len(rows), cols=max(len(r) for r in rows))
                tb.style = "Table Grid"
                for i, r in enumerate(rows):
                    for j, v in enumerate(r):
                        tb.cell(i, j).text = str(v)
            elif t == "image":
                d.add_picture(str(self.path(b["path"], True)), width=None)
            elif t == "page_break":
                d.add_page_break()
            else:
                raise FileError(f"unknown block type {t!r}")
        p = self.path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        d.save(p)
        return f"wrote {rel} ({len(blocks)} blocks)"

    def doc_read(self, rel: str) -> str:
        d = _lib("docx").Document(self.path(rel, True))
        out = [f"[{p.style.name}] {p.text}" for p in d.paragraphs if p.text.strip()]
        for ti, t in enumerate(d.tables):
            out += [f"[table {ti}] " + " | ".join(c.text for c in r.cells) for r in t.rows]
        return "\n".join(out)

    def doc_edit(self, rel: str, ops: list) -> str:
        """ops: {op: replace, old, new} | {op: append, text, style?} | {op: delete, index} | {op: insert_after, index, text}"""
        p = self.path(rel, True)
        d = _lib("docx").Document(p)
        done = 0
        for o in ops:
            k = o.get("op")
            if k == "replace":
                for para in d.paragraphs:
                    if o["old"] in para.text:
                        full = para.text.replace(o["old"], o["new"])
                        for r in para.runs[1:]:
                            r.text = ""
                        if para.runs:
                            para.runs[0].text = full
                        else:
                            para.add_run(full)
                        done += 1
            elif k == "append":
                d.add_paragraph(o["text"], style=o.get("style"))
                done += 1
            elif k == "delete":
                el = d.paragraphs[int(o["index"])]._element
                el.getparent().remove(el)
                done += 1
            elif k == "insert_after":
                anchor = d.paragraphs[int(o["index"])]
                new = d.add_paragraph(o["text"])
                anchor._element.addnext(new._element)
                done += 1
            else:
                raise FileError(f"unknown doc op {k!r}")
        d.save(p)
        return f"{done} change(s) in {rel}"

    # ------------------------------------------------------------------ Excel
    def sheet_create(self, rel: str, sheets: dict) -> str:
        """sheets: {"Name": [[row], [row] ...]} (a string starting with = is a formula)"""
        ox = _lib("openpyxl")
        wb = ox.Workbook()
        wb.remove(wb.active)
        for name, rows in sheets.items():
            ws = wb.create_sheet(str(name)[:31])
            for r in rows:
                ws.append(list(r))
        p = self.path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        wb.save(p)
        return f"wrote {rel} ({len(sheets)} sheet(s))"

    def sheet_read(self, rel: str, sheet: str = "", cell_range: str = "") -> str:
        wb = _lib("openpyxl").load_workbook(self.path(rel, True), data_only=False)
        ws = wb[sheet] if sheet else wb.active
        cells = ws[cell_range] if cell_range else ws.iter_rows()
        rows = cells if cell_range and isinstance(cells[0], tuple) else (cells if not cell_range else (cells,))
        return "\n".join("\t".join("" if c.value is None else str(c.value) for c in r) for r in rows)[:20000]

    def sheet_edit(self, rel: str, ops: list) -> str:
        """ops: {op: set, cell: "B2", value} | {op: add_sheet, name} | {op: append_row, sheet?, values} | {op: delete_sheet, name}"""
        p = self.path(rel, True)
        wb = _lib("openpyxl").load_workbook(p)
        for o in ops:
            k = o.get("op")
            ws = wb[o["sheet"]] if o.get("sheet") else wb.active
            if k == "set":
                ws[o["cell"]] = o["value"]
            elif k == "append_row":
                ws.append(list(o["values"]))
            elif k == "add_sheet":
                wb.create_sheet(str(o["name"])[:31])
            elif k == "delete_sheet":
                del wb[o["name"]]
            else:
                raise FileError(f"unknown sheet op {k!r}")
        wb.save(p)
        return f"{len(ops)} change(s) in {rel}"

    # ------------------------------------------------------------------ PowerPoint
    def slides_create(self, rel: str, slides: list) -> str:
        """slides: [{title, bullets?: [..], image?: path, notes?}]"""
        pp = _lib("pptx")
        prs = pp.Presentation()
        for s in slides:
            layout = prs.slide_layouts[1 if s.get("bullets") else 5 if not s.get("image") else 5]
            sl = prs.slides.add_slide(layout)
            sl.shapes.title.text = s.get("title", "")
            if s.get("bullets"):
                tf = sl.placeholders[1].text_frame
                tf.text = s["bullets"][0]
                for b in s["bullets"][1:]:
                    tf.add_paragraph().text = b
            if s.get("image"):
                from pptx.util import Inches
                sl.shapes.add_picture(str(self.path(s["image"], True)), Inches(1), Inches(1.8), width=Inches(8))
            if s.get("notes"):
                sl.notes_slide.notes_text_frame.text = s["notes"]
        p = self.path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        prs.save(p)
        return f"wrote {rel} ({len(slides)} slides)"

    def slides_read(self, rel: str) -> str:
        prs = _lib("pptx").Presentation(self.path(rel, True))
        out = []
        for i, sl in enumerate(prs.slides, 1):
            out.append(f"--- slide {i}")
            out += [sh.text_frame.text for sh in sl.shapes if sh.has_text_frame and sh.text_frame.text.strip()]
        return "\n".join(out)

    def slides_edit(self, rel: str, ops: list) -> str:
        """ops: {op: replace, old, new} | {op: delete, index} | {op: add, title, bullets?}"""
        p = self.path(rel, True)
        prs = _lib("pptx").Presentation(p)
        n = 0
        for o in ops:
            k = o.get("op")
            if k == "replace":
                for sl in prs.slides:
                    for sh in sl.shapes:
                        if sh.has_text_frame:
                            for para in sh.text_frame.paragraphs:
                                for r in para.runs:
                                    if o["old"] in r.text:
                                        r.text = r.text.replace(o["old"], o["new"])
                                        n += 1
            elif k == "delete":
                ids = prs.slides._sldIdLst
                sid = list(ids)[int(o["index"])]
                prs.part.drop_rel(sid.rId)
                ids.remove(sid)
                n += 1
            elif k == "add":
                sl = prs.slides.add_slide(prs.slide_layouts[1 if o.get("bullets") else 5])
                sl.shapes.title.text = o.get("title", "")
                if o.get("bullets"):
                    tf = sl.placeholders[1].text_frame
                    tf.text = o["bullets"][0]
                    for b in o["bullets"][1:]:
                        tf.add_paragraph().text = b
                n += 1
            else:
                raise FileError(f"unknown slides op {k!r}")
        prs.save(p)
        return f"{n} change(s) in {rel}"

    # ------------------------------------------------------------------ PDF
    def pdf_create(self, rel: str, blocks: list) -> str:
        _lib("reportlab")
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table
        from xml.sax.saxutils import escape
        st = getSampleStyleSheet()
        story = []
        for b in blocks:
            t = b.get("type", "paragraph")
            if t == "heading":
                story.append(Paragraph(escape(b["text"]), st["Heading%d" % min(3, max(1, int(b.get("level", 1))))]))
            elif t == "paragraph":
                story.append(Paragraph(escape(b["text"]), st["BodyText"]))
            elif t == "table":
                story.append(Table([[str(c) for c in r] for r in b["rows"]]))
            elif t == "spacer":
                story.append(Spacer(1, int(b.get("height", 12))))
            elif t == "page_break":
                story.append(PageBreak())
            else:
                raise FileError(f"unknown block type {t!r}")
        p = self.path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        SimpleDocTemplate(str(p)).build(story)
        return f"wrote {rel}"

    def pdf_read(self, rel: str, pages: str = "") -> str:
        r = _lib("pypdf").PdfReader(self.path(rel, True))
        idx = _page_list(pages, len(r.pages)) if pages else range(len(r.pages))
        return "\n".join(f"--- page {i + 1}\n{r.pages[i].extract_text() or ''}" for i in idx)[:50000]

    def pdf_edit(self, rel: str, ops: list, out: str = "") -> str:
        """ops: {op: extract, pages: "1-3,5"} | {op: rotate, pages, degrees} | {op: merge, with: path} | {op: delete, pages}"""
        pypdf = _lib("pypdf")
        src = self.path(rel, True)
        r = pypdf.PdfReader(src)
        pages = list(r.pages)
        for o in ops:
            k = o.get("op")
            if k == "extract":
                pages = [pages[i] for i in _page_list(o["pages"], len(pages))]
            elif k == "delete":
                drop = set(_page_list(o["pages"], len(pages)))
                pages = [pg for i, pg in enumerate(pages) if i not in drop]
            elif k == "rotate":
                for i in _page_list(o.get("pages", f"1-{len(pages)}"), len(pages)):
                    pages[i].rotate(int(o.get("degrees", 90)))
            elif k == "merge":
                pages += list(pypdf.PdfReader(self.path(o["with"], True)).pages)
            else:
                raise FileError(f"unknown pdf op {k!r}")
        w = pypdf.PdfWriter()
        for pg in pages:
            w.add_page(pg)
        target = self.path(out) if out else src
        with open(target, "wb") as f:
            w.write(f)
        return f"wrote {out or rel} ({len(pages)} pages)"

    # ------------------------------------------------------------------ images
    def image_edit(self, rel: str, ops: list, out: str = "") -> str:
        """ops: resize{width,height?} | crop{box:[l,t,r,b]} | rotate{degrees} | convert{mode} | flip{axis} | filter{name: blur|sharpen|grayscale|contour} | text{text,xy,size?}"""
        pil = _lib("PIL")
        from PIL import Image, ImageDraw, ImageFilter, ImageOps
        im = Image.open(self.path(rel, True))
        for o in ops:
            k = o.get("op")
            if k == "resize":
                w = int(o["width"])
                h = int(o["height"]) if o.get("height") else max(1, round(im.height * w / im.width))
                if not (1 <= w <= 20000 and 1 <= h <= 20000):
                    raise FileError("size out of range")
                im = im.resize((w, h))
            elif k == "crop":
                im = im.crop(tuple(int(v) for v in o["box"]))
            elif k == "rotate":
                im = im.rotate(float(o["degrees"]), expand=True)
            elif k == "convert":
                im = im.convert(o["mode"])
            elif k == "flip":
                im = ImageOps.mirror(im) if o.get("axis", "x") == "x" else ImageOps.flip(im)
            elif k == "filter":
                f = o["name"]
                im = {"blur": lambda i: i.filter(ImageFilter.GaussianBlur(2)), "sharpen": lambda i: i.filter(ImageFilter.SHARPEN),
                      "grayscale": lambda i: ImageOps.grayscale(i), "contour": lambda i: i.filter(ImageFilter.CONTOUR)}[f](im)
            elif k == "text":
                ImageDraw.Draw(im).text(tuple(o["xy"]), o["text"], fill=o.get("color", "white"))
            else:
                raise FileError(f"unknown image op {k!r}")
        target = self.path(out) if out else self.path(rel)
        if target.suffix.lower() in (".jpg", ".jpeg") and im.mode in ("RGBA", "P"):
            im = im.convert("RGB")
        target.parent.mkdir(parents=True, exist_ok=True)
        im.save(target)
        return f"wrote {out or rel} ({im.width}x{im.height})"

    # ------------------------------------------------------------------ audio / video / conversion by program
    def av_info(self, rel: str) -> str:
        return self._run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=codec_name,width,height,sample_rate,channels", "-of", "json", str(self.path(rel, True))])

    def av_edit(self, rel: str, ops: list, out: str) -> str:
        """ops: trim{start,seconds} | scale{width} | extract_audio | speed{factor} | volume{factor} | mute | to_gif{fps?} - one ffmpeg run, arguments are built here."""
        src, dst = self.path(rel, True), self.path(out)
        dst.parent.mkdir(parents=True, exist_ok=True)
        pre, vf, af, extra = [], [], [], []
        for o in ops:
            k = o.get("op")
            if k == "trim":
                pre += ["-ss", str(float(o["start"]))]
                extra += ["-t", str(float(o["seconds"]))]
            elif k == "scale":
                vf.append(f"scale={int(o['width'])}:-2")
            elif k == "extract_audio":
                extra += ["-vn"]
            elif k == "speed":
                f = float(o["factor"])
                if not 0.25 <= f <= 4:
                    raise FileError("speed factor must be between 0.25 and 4")
                vf.append(f"setpts={1 / f}*PTS")
                af.append(f"atempo={f}")
            elif k == "volume":
                af.append(f"volume={float(o['factor'])}")
            elif k == "mute":
                extra += ["-an"]
            elif k == "to_gif":
                vf.append(f"fps={int(o.get('fps', 10))}")
            else:
                raise FileError(f"unknown av op {k!r}")
        args = ["ffmpeg", "-y", "-v", "error"] + pre + ["-i", str(src)] + extra
        if vf:
            args += ["-vf", ",".join(vf)]
        if af:
            args += ["-af", ",".join(af)]
        self._run(args + [str(dst)])
        return f"wrote {out}"

    def convert(self, rel: str, to: str) -> str:
        """Between document formats with pandoc (md html docx odt rtf epub txt tex), office files to pdf/csv/xlsx with LibreOffice, images with Pillow, audio/video with ffmpeg."""
        src = self.path(rel, True)
        ext_from, ext_to = src.suffix.lower().lstrip("."), to.lower().lstrip(".")
        dst = src.with_suffix("." + ext_to)
        if self.root not in dst.resolve().parents:
            raise FileError("path leaves the workspace")
        doc = {"md", "markdown", "html", "docx", "odt", "rtf", "epub", "txt", "tex", "rst"}
        office = {"docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf"}
        img = {"png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff", "ico"}
        av = {"mp3", "wav", "ogg", "flac", "aac", "m4a", "mp4", "webm", "mkv", "avi", "mov", "gif"}
        if ext_from in img and ext_to in img:
            _lib("PIL")
            from PIL import Image
            im = Image.open(src)
            if ext_to in ("jpg", "jpeg") and im.mode in ("RGBA", "P"):
                im = im.convert("RGB")
            im.save(dst)
        elif ext_from in av and ext_to in av:
            self._run(["ffmpeg", "-y", "-v", "error", "-i", str(src), str(dst)])
        elif ext_from in doc and ext_to in doc:
            self._run(["pandoc", str(src), "-o", str(dst)])
        elif ext_from in office and ext_to in ("pdf", "docx", "xlsx", "pptx", "csv", "odt", "ods", "odp", "html", "txt"):
            self._run(["soffice", "--headless", "--convert-to", ext_to, "--outdir", str(src.parent), str(src)], timeout=180)
        else:
            raise FileError(f"no conversion from {ext_from or '?'} to {ext_to}")
        if not dst.exists():
            raise FileError("conversion produced no file")
        return f"wrote {dst.relative_to(self.root)}"

    # ------------------------------------------------------------------ archives (zip-slip safe)
    def archive_create(self, paths: list, out: str, fmt: str = "zip") -> str:
        dst = self.path(out)
        dst.parent.mkdir(parents=True, exist_ok=True)
        files = [self.path(p, True) for p in paths]
        if fmt == "zip":
            with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
                for f in files:
                    for g in ([f] if f.is_file() else [x for x in f.rglob("*") if x.is_file()]):
                        z.write(g, g.relative_to(self.root))
        elif fmt in ("tar", "tar.gz"):
            with tarfile.open(dst, "w:gz" if fmt == "tar.gz" else "w") as t:
                for f in files:
                    t.add(f, arcname=str(f.relative_to(self.root)))
        else:
            raise FileError("format must be zip, tar or tar.gz")
        return f"wrote {out}"

    def archive_list(self, rel: str) -> str:
        p = self.path(rel, True)
        if zipfile.is_zipfile(p):
            with zipfile.ZipFile(p) as z:
                return "\n".join(f"{i.file_size}\t{i.filename}" for i in z.infolist())
        with tarfile.open(p) as t:
            return "\n".join(f"{m.size}\t{m.name}" for m in t.getmembers())

    def archive_extract(self, rel: str, to: str = "") -> str:
        p = self.path(rel, True)
        dest = self.path(to) if to else self.path(p.stem)
        dest.mkdir(parents=True, exist_ok=True)
        total, count = 0, 0
        def safe(name: str) -> Path:
            t = (dest / name).resolve()
            if t != dest and dest not in t.parents:
                raise FileError(f"unsafe path in archive: {name}")
            return t
        if zipfile.is_zipfile(p):
            with zipfile.ZipFile(p) as z:
                for i in z.infolist():
                    total += i.file_size
                    count += 1
                    if total > MAX_BYTES or count > 20000:
                        raise FileError("archive too large (zip bomb guard)")
                    safe(i.filename)
                z.extractall(dest)
        else:
            with tarfile.open(p) as t:
                for m in t.getmembers():
                    total += m.size
                    count += 1
                    if m.issym() or m.islnk() or m.isdev():
                        raise FileError(f"links and devices are not extracted: {m.name}")
                    if total > MAX_BYTES or count > 20000:
                        raise FileError("archive too large (bomb guard)")
                    safe(m.name)
                t.extractall(dest, filter="data")
        return f"extracted {count} entries to {dest.relative_to(self.root)}"


def _page_list(spec: str, n: int) -> list[int]:
    """'1-3,5' -> zero-based [0,1,2,4], bounds checked."""
    out: list[int] = []
    for part in str(spec).split(","):
        a, _, b = part.strip().partition("-")
        lo, hi = int(a), int(b or a)
        if lo < 1 or hi > n or lo > hi:
            raise FileError(f"pages {part!r} outside 1-{n}")
        out += list(range(lo - 1, hi))
    return out


def run_file_tool(ws: Workspace, name: str, a: dict) -> tuple[bool, str]:
    """Run one `files` tool (already validated by tools.validate). Returns (ok, text); a missing library or a bad file is a clear failure, never a crash."""
    try:
        table = {
            "file_info": lambda: json.dumps(ws.info(a["path"])), "image_info": lambda: json.dumps(ws.info(a["path"])), "av_info": lambda: ws.av_info(a["path"]),
            "file_read": lambda: ws.read_text(a["path"], int(a.get("start", 1)), int(a.get("lines", 200))), "file_write": lambda: ws.write_text(a["path"], a["content"]),
            "file_edit": lambda: ws.edit_text(a["path"], a["old"], a["new"]), "doc_create": lambda: ws.doc_create(a["path"], a["blocks"]),
            "doc_read": lambda: ws.doc_read(a["path"]), "doc_edit": lambda: ws.doc_edit(a["path"], a["ops"]),
            "sheet_create": lambda: ws.sheet_create(a["path"], a["sheets"]), "sheet_read": lambda: ws.sheet_read(a["path"], a.get("sheet", ""), a.get("range", "")),
            "sheet_edit": lambda: ws.sheet_edit(a["path"], a["ops"]), "slides_create": lambda: ws.slides_create(a["path"], a["slides"]),
            "slides_read": lambda: ws.slides_read(a["path"]), "slides_edit": lambda: ws.slides_edit(a["path"], a["ops"]),
            "pdf_create": lambda: ws.pdf_create(a["path"], a["blocks"]), "pdf_read": lambda: ws.pdf_read(a["path"], a.get("pages", "")),
            "pdf_edit": lambda: ws.pdf_edit(a["path"], a["ops"], a.get("out", "")), "image_edit": lambda: ws.image_edit(a["path"], a["ops"], a.get("out", "")),
            "av_edit": lambda: ws.av_edit(a["path"], a["ops"], a["out"]), "file_convert": lambda: ws.convert(a["path"], a["to"]),
            "archive_create": lambda: ws.archive_create(a["paths"], a["out"], a.get("format", "zip")), "archive_list": lambda: ws.archive_list(a["path"]),
            "archive_extract": lambda: ws.archive_extract(a["path"], a.get("to", "")),
            "data_transform": lambda: ws.data_transform(a["path"], a["op"], a.get("expr", ""), a.get("out", "")),
        }
        if name not in table:
            return False, f"{name} is not a files tool"
        return True, table[name]()
    except FileError as exc:
        return False, str(exc)
    except (KeyError, IndexError, ValueError, TypeError, json.JSONDecodeError, OSError, zipfile.BadZipFile, tarfile.TarError) as exc:
        return False, f"{type(exc).__name__}: {str(exc)[:300]}"
    except Exception as exc:  # noqa: BLE001  (a library error on a corrupt file must not kill the agent loop)
        return False, f"{type(exc).__name__}: {str(exc)[:300]}"
