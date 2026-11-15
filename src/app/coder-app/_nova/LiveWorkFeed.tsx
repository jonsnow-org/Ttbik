"use client";
// Live feed of what the model is doing (owner order 2026-11-15: a real live stream of Nova's work, not a label). It finds the owner's
// running task, follows its event stream, and lists each tool call (command, file read, edit, publish) the moment it happens.
import { useEffect, useRef, useState } from "react";
import { api, type Task } from "./parts";
import { rawInitData } from "../_tma/sdk";
import { splitSseFrames, sseFrameData } from "@/lib/liveEvents";

type Line = { id: number; kind: string; text: string };
const NOISE = /جاري قراءة المهمة|العامل الخلفي|الطابور|استجابة خادم النموذج|يقرأ \d+ رمزاً/;

export default function LiveWorkFeed({ ar }: { ar: boolean }) {
  const [run, setRun] = useState<Task | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const box = useRef<HTMLDivElement>(null);

  // 1) find the running task (poll while the tab is visible)
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const d = await api<{ tasks: Task[] }>("tasks", { limit: 5 });
        if (stopped) return;
        const r = d.tasks.find((t) => t.status === "running" || t.status === "waiting") || null;
        setRun((cur) => (cur?.run_id === r?.run_id ? cur : r));
      } catch { /* keep the last state */ }
    };
    void tick();
    const timer = setInterval(tick, 6000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);

  // 2) follow its events
  useEffect(() => {
    setLines([]);
    const runId = run?.run_id;
    if (!runId) return;
    let stopped = false;
    let controller: AbortController | undefined;
    let cursor = 0;
    const loop = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const r = await fetch(`/api/coder/stream?runId=${encodeURIComponent(runId)}&after=${cursor}`, { headers: { "x-telegram-init-data": rawInitData() }, cache: "no-store", signal: controller.signal });
          if (!r.ok || !r.body) throw new Error("stream unavailable");
          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { frames, rest } = splitSseFrames(buffer);
            buffer = rest;
            const add: Line[] = [];
            for (const f of frames) {
              const ev = sseFrameData(f);
              if (!ev) continue;
              cursor = Math.max(cursor, ev.id);
              if ((ev.kind === "tool" || ev.kind === "info" || ev.kind === "done" || ev.kind === "failed") && !NOISE.test(ev.text)) add.push({ id: ev.id, kind: ev.kind, text: String(ev.text).slice(0, 220) });
            }
            if (add.length) setLines((prev) => [...prev, ...add].slice(-40));
          }
        } catch { /* reconnect */ }
        if (stopped) return;
        await new Promise((res) => setTimeout(res, 1500));
      }
    };
    void loop();
    return () => { stopped = true; controller?.abort(); };
  }, [run?.run_id]);

  useEffect(() => { const b = box.current; if (b) b.scrollTop = b.scrollHeight; }, [lines.length]);

  return (
    <div className="n-card" style={{ padding: 10, marginTop: 8 }} aria-live="polite">
      <div className="n-meta" style={{ marginBottom: 6, fontWeight: 600 }}>
        {run ? `🔴 ${ar ? "بث مباشر لعمل النموذج" : "Live: what the model is doing"}` : `⚪ ${ar ? "لا مهمة جارية الآن" : "No task running now"}`}
      </div>
      <div ref={box} style={{ maxHeight: 180, overflowY: "auto", font: "12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace", direction: "auto" as never }}>
        {lines.length === 0 ? <div className="n-meta">{run ? (ar ? "بانتظار الخطوة التالية…" : "waiting for the next step…") : ""}</div>
          : lines.map((l) => <div key={l.id} style={{ opacity: l.kind === "tool" ? 1 : 0.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{l.text}</div>)}
      </div>
    </div>
  );
}
