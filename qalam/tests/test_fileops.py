import io
import json
import shutil
import subprocess
import tarfile
import zipfile

import pytest

from qalam import fileops, tools
from qalam.fileops import FileError, Workspace, run_file_tool

CAP = fileops.capabilities()


@pytest.fixture()
def ws(tmp_path) -> Workspace:
    return Workspace(tmp_path / "work")


def run(ws, name, **args):
    v = tools.validate(name, args, {"files"})
    assert v.ok, (name, v.reason)
    assert not v.needs_approval                                     # workspace-confined file work needs no click
    return run_file_tool(ws, name, args)


def test_registry_files_tools_all_have_executors_and_validate(ws):
    for n, s in tools.REGISTRY.items():
        if s.group == "files":
            ok, msg = run_file_tool(ws, n, {})
            assert msg != f"{n} is not a files tool", n                  # every registered files tool is wired to the executor


def test_paths_cannot_leave_the_workspace(ws):
    for bad in ("../x", "/etc/passwd", "a/../../x", "~/x", ""):
        with pytest.raises(FileError):
            ws.path(bad)
    (ws.root / "link").symlink_to("/etc")
    with pytest.raises(FileError):
        ws.path("link/passwd")                                       # a symlink out is resolved and refused
    ok, msg = run_file_tool(ws, "file_write", {"path": "../evil", "content": "x"})
    assert not ok and "workspace" in msg


def test_text_write_read_edit_and_data(ws):
    assert run(ws, "file_write", path="notes/a.md", content="one\ntwo\nthree\n")[0]
    ok, out = run(ws, "file_read", path="notes/a.md", start=2, lines=1)
    assert ok and out == "2\ttwo"
    assert run(ws, "file_edit", path="notes/a.md", old="two", new="TWO")[0]
    assert not run(ws, "file_edit", path="notes/a.md", old="zzz", new="y")[0]
    run(ws, "file_write", path="d.csv", content="name,n\nx,1\ny,2\n")
    assert run(ws, "data_transform", path="d.csv", op="to_json", out="d.json")[0]
    assert json.loads((ws.root / "d.json").read_text()) == [{"name": "x", "n": "1"}, {"name": "y", "n": "2"}]
    assert run(ws, "data_transform", path="d.json", op="set", expr="0.n=99")[0]
    ok, out = run(ws, "data_transform", path="d.json", op="query", expr="0.n")
    assert ok and json.loads(out) == 99
    assert run(ws, "data_transform", path="d.json", op="to_csv", out="back.csv")[0] and "99" in (ws.root / "back.csv").read_text()
    assert run(ws, "data_transform", path="d.json", op="to_yaml", out="d.yaml")[0]


@pytest.mark.skipif(not CAP["docx"], reason="python-docx missing")
def test_word_create_read_edit(ws):
    blocks = [{"type": "heading", "text": "Report", "level": 1}, {"type": "paragraph", "text": "Hello world"},
              {"type": "list", "items": ["a", "b"]}, {"type": "table", "rows": [["k", "v"], ["x", 1]]}]
    assert run(ws, "doc_create", path="r.docx", blocks=blocks)[0]
    text = run(ws, "doc_read", path="r.docx")[1]
    assert "Report" in text and "Hello world" in text and "k | v" in text
    assert run(ws, "doc_edit", path="r.docx", ops=[{"op": "replace", "old": "world", "new": "Qalam"}, {"op": "append", "text": "The end"}])[0]
    text = run(ws, "doc_read", path="r.docx")[1]
    assert "Hello Qalam" in text and "The end" in text
    assert not run(ws, "doc_edit", path="r.docx", ops=[{"op": "explode"}])[0]
    assert not run_file_tool(ws, "doc_create", {"path": "b.docx", "blocks": [{"type": "nope"}]})[0]


@pytest.mark.skipif(not CAP["xlsx"], reason="openpyxl missing")
def test_excel_create_read_edit_with_formula(ws):
    assert run(ws, "sheet_create", path="s.xlsx", sheets={"Data": [["a", "b"], [1, 2], [3, "=A3+1"]]})[0]
    assert run(ws, "sheet_edit", path="s.xlsx", ops=[{"op": "set", "cell": "B2", "value": 20}, {"op": "append_row", "values": [5, 6]}, {"op": "add_sheet", "name": "Extra"}])[0]
    out = run(ws, "sheet_read", path="s.xlsx", sheet="Data")[1]
    assert "20" in out and "=A3+1" in out and "5\t6" in out
    assert run(ws, "sheet_read", path="s.xlsx", sheet="Data", range="A1:B1")[1] == "a\tb"


@pytest.mark.skipif(not CAP["pptx"], reason="python-pptx missing")
def test_powerpoint_create_read_edit(ws):
    assert run(ws, "slides_create", path="p.pptx", slides=[{"title": "Intro", "bullets": ["one", "two"], "notes": "n"}, {"title": "End"}])[0]
    out = run(ws, "slides_read", path="p.pptx")[1]
    assert "Intro" in out and "one" in out and "slide 2" in out
    assert run(ws, "slides_edit", path="p.pptx", ops=[{"op": "replace", "old": "Intro", "new": "Hello"}, {"op": "add", "title": "Extra"}, {"op": "delete", "index": 1}])[0]
    out = run(ws, "slides_read", path="p.pptx")[1]
    assert "Hello" in out and "Extra" in out and out.count("--- slide") == 2


@pytest.mark.skipif(not (CAP["pdf_create"] and CAP["pdf_edit"]), reason="reportlab/pypdf missing")
def test_pdf_create_read_edit(ws):
    blocks = [{"type": "heading", "text": "Title"}, {"type": "paragraph", "text": "page one"}, {"type": "page_break"}, {"type": "paragraph", "text": "page two"},
              {"type": "page_break"}, {"type": "paragraph", "text": "page three"}]
    assert run(ws, "pdf_create", path="a.pdf", blocks=blocks)[0]
    assert "page two" in run(ws, "pdf_read", path="a.pdf", pages="2")[1]
    assert run(ws, "pdf_edit", path="a.pdf", ops=[{"op": "extract", "pages": "1,3"}], out="b.pdf")[0]
    text = run(ws, "pdf_read", path="b.pdf")[1]
    assert "page one" in text and "page three" in text and "page two" not in text
    assert run(ws, "pdf_edit", path="b.pdf", ops=[{"op": "merge", "with": "a.pdf"}, {"op": "rotate", "pages": "1", "degrees": 90}], out="c.pdf")[0]
    assert run(ws, "pdf_read", path="c.pdf")[1].count("--- page") == 5
    assert not run(ws, "pdf_read", path="a.pdf", pages="9")[0]


@pytest.mark.skipif(not CAP["image"], reason="Pillow missing")
def test_image_edit_and_convert(ws):
    from PIL import Image
    Image.new("RGB", (40, 20), "red").save(ws.root / "i.png")
    assert run(ws, "image_edit", path="i.png", ops=[{"op": "resize", "width": 80}, {"op": "filter", "name": "grayscale"}, {"op": "text", "text": "hi", "xy": [2, 2]}], out="o.png")[0]
    assert Image.open(ws.root / "o.png").size == (80, 40)
    assert run(ws, "image_edit", path="i.png", ops=[{"op": "crop", "box": [0, 0, 10, 10]}, {"op": "rotate", "degrees": 90}], out="c.jpg")[0]
    assert Image.open(ws.root / "c.jpg").size == (10, 10)
    assert run(ws, "file_convert", path="i.png", to="webp")[0] and (ws.root / "i.webp").exists()
    assert not run(ws, "image_edit", path="i.png", ops=[{"op": "resize", "width": 999999}], out="x.png")[0]
    info = json.loads(run(ws, "file_info", path="i.png")[1])
    assert info["kind"] == "png" and info["bytes"] > 0


@pytest.mark.skipif(not CAP["ffmpeg"], reason="ffmpeg missing")
def test_audio_and_video_edit_and_convert(ws):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", str(ws.root / "t.wav")], check=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10", "-pix_fmt", "yuv420p", str(ws.root / "v.mp4")], check=True)
    assert run(ws, "av_edit", path="t.wav", ops=[{"op": "trim", "start": 0.5, "seconds": 1}, {"op": "volume", "factor": 0.5}], out="short.wav")[0]
    assert 0.9 < float(json.loads(run(ws, "av_info", path="short.wav")[1])["format"]["duration"]) < 1.2
    assert run(ws, "file_convert", path="t.wav", to="mp3")[0] and (ws.root / "t.mp3").exists()
    assert run(ws, "av_edit", path="v.mp4", ops=[{"op": "scale", "width": 80}, {"op": "speed", "factor": 2}], out="fast.mp4")[0]
    info = json.loads(run(ws, "av_info", path="fast.mp4")[1])
    assert any(s.get("width") == 80 for s in info["streams"])
    ok, msg = run(ws, "av_edit", path="v.mp4", ops=[{"op": "extract_audio"}], out="a.mp3")
    assert not ok and "ffmpeg failed" in msg                      # the test video has no audio stream: a clear failure, not a crash
    assert run(ws, "av_edit", path="t.wav", ops=[{"op": "extract_audio"}], out="a.mp3")[0]
    assert not run(ws, "av_edit", path="v.mp4", ops=[{"op": "speed", "factor": 99}], out="x.mp4")[0]
    assert run(ws, "av_edit", path="v.mp4", ops=[{"op": "to_gif", "fps": 5}], out="g.gif")[0] and (ws.root / "g.gif").stat().st_size > 0


@pytest.mark.skipif(not CAP["pandoc"], reason="pandoc missing")
def test_document_conversion_by_pandoc(ws):
    run(ws, "file_write", path="n.md", content="# Title\n\nSome **bold** text.\n")
    assert run(ws, "file_convert", path="n.md", to="html")[0] and "<strong>bold</strong>" in (ws.root / "n.html").read_text()
    assert run(ws, "file_convert", path="n.md", to="docx")[0] and (ws.root / "n.docx").stat().st_size > 1000
    assert not run(ws, "file_convert", path="n.md", to="exe")[0]


@pytest.mark.skipif(not (CAP["libreoffice"] and CAP["docx"]), reason="LibreOffice missing")
def test_office_to_pdf_by_libreoffice(ws):
    run(ws, "doc_create", path="l.docx", blocks=[{"type": "paragraph", "text": "convert me"}])
    ok, msg = run(ws, "file_convert", path="l.docx", to="pdf")
    assert ok, msg
    assert (ws.root / "l.pdf").read_bytes().startswith(b"%PDF")


def test_archives_roundtrip_and_attacks(ws):
    run(ws, "file_write", path="src/a.txt", content="A")
    run(ws, "file_write", path="src/sub/b.txt", content="B")
    for fmt, name in (("zip", "x.zip"), ("tar.gz", "x.tgz"), ("tar", "x.tar")):
        assert run(ws, "archive_create", paths=["src"], out=name, format=fmt)[0]
        assert "src/a.txt" in run(ws, "archive_list", path=name)[1]
        assert run(ws, "archive_extract", path=name, to=f"out_{fmt}")[0] and (ws.root / f"out_{fmt}" / "src" / "sub" / "b.txt").read_text() == "B"
    with zipfile.ZipFile(ws.root / "evil.zip", "w") as z:                    # zip-slip
        z.writestr("../../escape.txt", "x")
    ok, msg = run(ws, "archive_extract", path="evil.zip", to="o1")
    assert not ok and "unsafe" in msg and not (ws.root.parent / "escape.txt").exists()
    with tarfile.open(ws.root / "link.tar", "w") as t:                      # a symlink inside a tar
        info = tarfile.TarInfo("l")
        info.type = tarfile.SYMTYPE
        info.linkname = "/etc/passwd"
        t.addfile(info)
    assert not run(ws, "archive_extract", path="link.tar", to="o2")[0]
    old = fileops.MAX_BYTES
    fileops.MAX_BYTES = 1
    try:
        assert "too large" in run(ws, "archive_extract", path="x.zip", to="o3")[1]       # bomb guard
    finally:
        fileops.MAX_BYTES = old


def test_tools_group_needs_loading_and_dangerous_ones_still_need_approval():
    assert not tools.validate("doc_create", {"path": "a.docx", "blocks": []}).ok          # group not loaded
    assert tools.validate("deploy", {"target": "x", "path": "dist"}, {"dev"}).needs_confirmation
    assert tools.validate("send_email", {"to": "a@b.c", "subject": "s", "body": "b"}, {"web"}).needs_approval
    assert tools.validate("download_file", {"url": "https://example.com/f", "path": "f"}, {"web"}).needs_approval
    assert not tools.validate("download_file", {"url": "http://127.0.0.1/f", "path": "f"}, {"web"}).ok
    assert tools.validate("install_packages", {"manager": "pip", "packages": ["x"]}, {"dev"}).needs_approval
    assert tools.validate("project_scaffold", {"kind": "web", "name": "site"}, {"dev"}).ok
