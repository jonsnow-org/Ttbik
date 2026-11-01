"use client";
// The Mini App's "Computer" tab: the model's own FREE computer (ai-system/modelscope-media/computer_box.py) as a real terminal, file browser and background jobs.
// It is the same private session the model works in (files the model made are here; files you make here, the model sees). Replaces the old fake "NOVA / TERMINAL"
// log box in the Chats tab. Owner only (the server refuses everyone else).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./parts";
import type { Lang } from "../i18n";

const MODELS: { id: string; label: string }[] = [
  { id: "coder", label: "Nova AI" }, { id: "sham_v2", label: "Sham v2" }, { id: "qwen35-9b", label: "Qwen3.5" }, { id: "gemma4-e4b", label: "Gemma 4" }, { id: "minicpmo45", label: "MiniCPM-o" },
];
type Line = { cmd: string; out: string; code?: number | null; sec?: number; err?: boolean };
const mono = { font: "13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace", direction: "ltr" as const, textAlign: "left" as const };
const box = (model: string, args: Record<string, unknown>) => api<any>("box", { model, args });

function joinPath(cwd: string, arg: string): string {
  const parts = (arg.startsWith("/") || arg.startsWith("~") ? [] : cwd.split("/").filter((x) => x && x !== ".")).concat(arg.replace(/^~\/?/, "").split("/"));
  const out: string[] = [];
  for (const p of parts) { if (!p || p === ".") continue; if (p === "..") out.pop(); else out.push(p); }
  return out.join("/") || ".";
}

export default function FreeComputer({ lang, defaultModel, logs }: { lang: Lang; defaultModel: string; logs?: React.ReactNode }) {
  const ar = lang === "ar";
  const [model, setModel] = useState(MODELS.some((m) => m.id === defaultModel) ? defaultModel : "coder");
  const [tab, setTab] = useState<"desk" | "term" | "files" | "jobs" | "log">("desk");
  const [status, setStatus] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [cmd, setCmd] = useState("");
  const [cwd, setCwd] = useState(".");
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const endRef = useRef<HTMLDivElement>(null);
  const [folder, setFolder] = useState<{ path: string; entries: string[] } | null>(null);
  const [file, setFile] = useState<{ path: string; text: string; dirty: boolean } | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [err, setErr] = useState("");

  const loadStatus = useCallback(async () => { try { setStatus(await box(model, { action: "status" })); } catch (e: any) { setStatus({ ok: false, error: String(e?.message || e) }); } }, [model]);
  useEffect(() => { setLines([]); setCwd("."); setFolder(null); setFile(null); setJobs([]); void loadStatus(); }, [model, loadStatus]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [lines, busy]);

  const run = async (raw: string, background = false) => {
    const command = raw.trim();
    if (!command || busy) return;
    setBusy(true); setCmd(""); setHi(-1); setHist((h) => [command, ...h.filter((x) => x !== command)].slice(0, 50));
    try {
      const cd = /^cd(?:\s+(.*))?$/.exec(command);
      if (cd) {
        const target = joinPath(cwd, (cd[1] || "~").trim().replace(/^["']|["']$/g, "") || "~");
        const r = await box(model, { action: "read", path: target });
        if (r.ok && r.kind === "folder") { setCwd(target); setLines((l) => [...l, { cmd: command, out: "" }]); }
        else setLines((l) => [...l, { cmd: command, out: String(r.error || "cd: not a folder"), err: true }]);
      } else if (background) {
        const s = await box(model, { action: "job_start", command, cwd, name: command.slice(0, 40) });
        setLines((l) => [...l, { cmd: command, out: s.ok ? (ar ? `▶ يعمل في الخلفية (${s.id}) — راجع تبويب المهام` : `▶ running in background (${s.id}) — see the Jobs tab`) : String(s.error), err: !s.ok }]);
        if (s.ok) { setTab("jobs"); void loadJobs(); }
      } else {
        const r = await box(model, { action: "run", command, cwd, timeout: 90 });
        const out = [r.output, r.hint, r.error].filter(Boolean).join("\n");
        setLines((l) => [...l, { cmd: command, out, code: r.exit_code, sec: r.seconds, err: r.ok === false || (typeof r.exit_code === "number" && r.exit_code !== 0) }]);
      }
    } catch (e: any) { setLines((l) => [...l, { cmd: command, out: String(e?.message || e), err: true }]); }
    finally { setBusy(false); }
  };

  const openFolder = useCallback(async (path: string) => {
    setErr("");
    try { const r = await box(model, { action: "read", path }); if (!r.ok) throw new Error(r.error || "error"); if (r.kind === "folder") { setFolder({ path: r.path, entries: r.entries || [] }); setFile(null); } else setFile({ path: r.path, text: r.text || "", dirty: false }); }
    catch (e: any) { setErr(String(e?.message || e)); }
  }, [model]);
  useEffect(() => { if (tab === "files" && !folder && !file) void openFolder("."); }, [tab, folder, file, openFolder]);
  const saveFile = async () => { if (!file) return; const r = await box(model, { action: "write", path: file.path, content: file.text }).catch((e) => ({ ok: false, error: String(e?.message || e) })); if (r.ok) setFile({ ...file, dirty: false }); else setErr(String(r.error)); };

  // desktop: the model's own headless browser with a live screenshot; click on the picture, type, scroll
  const [page, setPage] = useState<{ url: string; title: string; shot: string; text: string; elements: string; error: string } | null>(null);
  const [addr, setAddr] = useState("https://example.com");
  const [deskBusy, setDeskBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const browse = async (args: Record<string, unknown>) => {
    setDeskBusy(true);
    try {
      const r = await api<any>("browser", { model, args });
      setPage({ url: String(r.url || ""), title: String(r.title || ""), shot: r.screenshot_b64 ? "data:image/jpeg;base64," + r.screenshot_b64 : (page?.shot || ""), text: String(r.text || ""), elements: String(r.elements || ""), error: r.ok === false ? String(r.error || "") : "" });
      if (r.url) setAddr(String(r.url));
    } catch (e: any) { setPage((p) => ({ url: p?.url || "", title: p?.title || "", shot: p?.shot || "", text: "", elements: "", error: String(e?.message || e) })); }
    finally { setDeskBusy(false); }
  };
  const tapPicture = (e: React.MouseEvent<HTMLImageElement>) => {
    const el = imgRef.current; if (!el || !el.naturalWidth) return;
    const rect = el.getBoundingClientRect();
    void browse({ action: "click", x: Math.round(((e.clientX - rect.left) / rect.width) * el.naturalWidth), y: Math.round(((e.clientY - rect.top) / rect.height) * el.naturalHeight) });
  };
  const loadJobs = useCallback(async () => { try { const r = await box(model, { action: "job_list" }); setJobs(r.jobs || []); } catch { /* shown on the next refresh */ } }, [model]);
  const [jobLog, setJobLog] = useState<{ id: string; text: string } | null>(null);
  const showJob = async (id: string) => { const r = await box(model, { action: "job_log", id, tail: 80 }).catch(() => null); setJobLog({ id, text: r ? [r.output, r.running ? (ar ? "… ما زال يعمل" : "… still running") : `exit ${r.exit_code}`].filter(Boolean).join("\n") : "?" }); };
  useEffect(() => { if (tab !== "jobs") return; void loadJobs(); const t = setInterval(() => { void loadJobs(); if (jobLog) void showJob(jobLog.id); }, 4000); return () => clearInterval(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, loadJobs, jobLog?.id]);

  const chip = (on: boolean) => ({ borderRadius: 999, padding: "6px 12px", border: "1px solid var(--n-line, #8883)", background: on ? "var(--n-accent, #0d9488)" : "transparent", color: on ? "#fff" : "inherit", font: "600 13px system-ui" });
  const tabs: [typeof tab, string][] = [["desk", ar ? "سطح المكتب" : "Desktop"], ["term", ar ? "الطرفية" : "Terminal"], ["files", ar ? "الملفات" : "Files"], ["jobs", ar ? "المهام الخلفية" : "Jobs"], ["log", ar ? "سجل المهام" : "Task log"]];
  const okStatus = status?.ok;
  return (
    <div className="n-page">
      <div className="n-card" style={{ padding: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {MODELS.map((m) => <button key={m.id} type="button" style={chip(model === m.id)} onClick={() => setModel(m.id)}>{m.label}</button>)}
        </div>
        <div className="n-meta" style={{ ...mono, fontSize: 12 }}>
          {status == null ? "…" : okStatus
            ? `${ar ? "حاسوب" : "computer"} · ${status.tools ? Object.entries(status.tools).filter(([, v]) => v).map(([k]) => k).join(" ") : ""} · ${status.your_disk_mb ?? 0} MB`
            : `⚠ ${String(status.error || (ar ? "الحاسوب غير متاح الآن (الاستوديو يعمل أو يعيد التشغيل)" : "computer unavailable now"))}`}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, margin: "10px 0", flexWrap: "wrap" }}>
        {tabs.map(([id, label]) => <button key={id} type="button" style={chip(tab === id)} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === "desk" && (
        <div className="n-card" style={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input value={addr} dir="ltr" onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void browse({ action: "open", url: addr }); }} style={{ ...mono, flex: 1, border: "1px solid #8884", borderRadius: 8, padding: 8 }} />
            <button type="button" className="n-btn" disabled={deskBusy} onClick={() => void browse({ action: "open", url: addr })}>{ar ? "فتح" : "Go"}</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <button type="button" className="n-btn n-ghost" disabled={deskBusy} onClick={() => void browse({ action: "back" })}>←</button>
            <button type="button" className="n-btn n-ghost" disabled={deskBusy} onClick={() => void browse({ action: "look" })}>⟳</button>
            <button type="button" className="n-btn n-ghost" disabled={deskBusy} onClick={() => void browse({ action: "scroll", dy: 600 })}>↓</button>
            <button type="button" className="n-btn n-ghost" disabled={deskBusy} onClick={() => void browse({ action: "scroll", dy: -600 })}>↑</button>
          </div>
          {deskBusy && <div className="n-meta">{ar ? "… يعمل" : "… working"}</div>}
          {page?.error && <div className="n-note" role="alert">{page.error}</div>}
          {page?.shot ? <img ref={imgRef} src={page.shot} alt={page.title} onClick={tapPicture} style={{ width: "100%", borderRadius: 8, border: "1px solid #8884", cursor: "pointer" }} /> : <div className="n-meta">{ar ? "المتصفح الخاص بحاسوب هذا النموذج: اكتب عنواناً واضغط «فتح». المتصفح نفسه الذي يستخدمه النموذج." : "This model's own browser: type an address and press Go. It is the same browser the model uses."}</div>}
          {page?.title && <div className="n-meta" style={{ marginTop: 6 }}>{page.title}</div>}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input id="deskType" dir="auto" placeholder={ar ? "اكتب نصاً في الحقل المحدد…" : "type into the focused field…"} style={{ flex: 1, border: "1px solid #8884", borderRadius: 8, padding: 8 }}
              onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value; (e.target as HTMLInputElement).value = ""; void browse({ action: "type", text: v, enter: true }); } }} />
          </div>
        </div>
      )}

      {tab === "term" && (
        <div className="n-card" style={{ padding: 0, overflow: "hidden", background: "#0b1220", color: "#d1fae5" }}>
          <div style={{ ...mono, padding: 12, maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {lines.length === 0 && <div style={{ color: "#94a3b8" }}>{ar ? "طرفية حقيقية على حاسوب النموذج (bash). جرّب: ls  ·  python3 -V  ·  git --version" : "A real shell on the model's computer (bash). Try: ls · python3 -V · git --version"}</div>}
            {lines.map((l, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ color: "#5eead4" }}>$ {l.cmd}</div>
                {l.out && <div style={{ color: l.err ? "#fca5a5" : "#e2e8f0" }}>{l.out}</div>}
                {typeof l.sec === "number" && <div style={{ color: "#64748b", fontSize: 11 }}>{l.sec}s{typeof l.code === "number" ? ` · exit ${l.code}` : ""}</div>}
              </div>
            ))}
            {busy && <div style={{ color: "#fbbf24" }}>{ar ? "… جارٍ التنفيذ" : "… running"}</div>}
            <div ref={endRef} />
          </div>
          <div style={{ display: "flex", gap: 6, padding: 8, background: "#111a2e", alignItems: "flex-end" }}>
            <span style={{ ...mono, color: "#5eead4", paddingBottom: 8 }}>{cwd === "." ? "~" : "~/" + cwd}$</span>
            <textarea value={cmd} rows={1} dir="ltr" disabled={busy} placeholder={ar ? "اكتب أمراً…" : "type a command…"}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void run(cmd); }
                else if (e.key === "ArrowUp" && hist.length) { e.preventDefault(); const n = Math.min(hi + 1, hist.length - 1); setHi(n); setCmd(hist[n]); }
                else if (e.key === "ArrowDown") { e.preventDefault(); const n = hi - 1; setHi(n); setCmd(n >= 0 ? hist[n] : ""); }
              }}
              style={{ ...mono, flex: 1, minHeight: 36, resize: "none", background: "#0b1220", color: "#f8fafc", border: "1px solid #334155", borderRadius: 8, padding: 8 }} />
            <button type="button" className="n-btn" disabled={busy || !cmd.trim()} onClick={() => void run(cmd)}>{ar ? "تنفيذ" : "Run"}</button>
            <button type="button" className="n-btn n-ghost" disabled={busy || !cmd.trim()} title={ar ? "أوامر أطول من 90 ثانية" : "for commands longer than 90 s"} onClick={() => void run(cmd, true)}>{ar ? "خلفية" : "BG"}</button>
          </div>
        </div>
      )}

      {tab === "files" && (
        <div className="n-card" style={{ padding: 12 }}>
          {err && <div className="n-note" role="alert">{err}</div>}
          {file ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <button type="button" className="n-btn n-ghost" onClick={() => { setFile(null); void openFolder(file.path.split("/").slice(0, -1).join("/") || "."); }}>←</button>
                <span style={mono}>{file.path}</span>
                <button type="button" className="n-btn" disabled={!file.dirty} onClick={() => void saveFile()}>{ar ? "حفظ" : "Save"}</button>
              </div>
              <textarea value={file.text} dir="ltr" onChange={(e) => setFile({ ...file, text: e.target.value, dirty: true })} style={{ ...mono, width: "100%", minHeight: 300, border: "1px solid #8884", borderRadius: 8, padding: 8 }} />
            </>
          ) : folder ? (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <button type="button" className="n-btn n-ghost" disabled={folder.path === "."} onClick={() => void openFolder(joinPath(folder.path, ".."))}>↑</button>
                <span style={mono}>~/{folder.path === "." ? "" : folder.path}</span>
                <button type="button" className="n-btn n-ghost" onClick={() => void openFolder(folder.path)}>⟳</button>
              </div>
              {folder.entries.length === 0 && <div className="n-meta">{ar ? "المجلد فارغ" : "empty folder"}</div>}
              {folder.entries.map((e) => { const isDir = e.startsWith("d "); const name = e.slice(2).replace(/ \(\d+ B\)$/, ""); return (
                <div key={e} role="button" tabIndex={0} onClick={() => void openFolder(joinPath(folder.path, name))} style={{ ...mono, padding: "8px 4px", borderBottom: "1px solid #8882", cursor: "pointer" }}>{isDir ? "📁 " : "📄 "}{e.slice(2)}</div>
              ); })}
            </>
          ) : <div className="n-meta">…</div>}
        </div>
      )}

      {tab === "jobs" && (
        <div className="n-card" style={{ padding: 12 }}>
          {jobs.length === 0 && <div className="n-meta">{ar ? "لا مهام خلفية. اكتب أمراً طويلاً في الطرفية واضغط «خلفية»." : "No background jobs. Type a long command in the terminal and press BG."}</div>}
          {jobs.map((j) => (
            <div key={j.id} style={{ padding: "8px 0", borderBottom: "1px solid #8882" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={mono}>{j.running ? "▶" : j.exit_code === 0 ? "✓" : "✗"} {j.id}</span>
                <span style={{ ...mono, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.command}</span>
                <button type="button" className="n-btn n-ghost" onClick={() => void showJob(j.id)}>{ar ? "السجل" : "Log"}</button>
                {j.running && <button type="button" className="n-btn n-ghost" onClick={async () => { await box(model, { action: "job_stop", id: j.id }).catch(() => null); void loadJobs(); }}>{ar ? "إيقاف" : "Stop"}</button>}
              </div>
            </div>
          ))}
          {jobLog && <pre style={{ ...mono, whiteSpace: "pre-wrap", marginTop: 10, background: "#0b1220", color: "#e2e8f0", padding: 10, borderRadius: 8, maxHeight: 260, overflow: "auto" }}>{jobLog.text}</pre>}
        </div>
      )}

      {tab === "log" && <div>{logs || <div className="n-meta">—</div>}</div>}
    </div>
  );
}
