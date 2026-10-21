// Owner control panel: weekly reset, log parsing, GPU split, owner-only ops and the GitHub-backed actions.
import { gpuHours, panelAction, statusLines, weekStart } from "@/lib/coderPanel";
import { appOp } from "@/lib/coderApp";
import { fakeDb } from "./coderFakes";

afterEach(() => {
  delete process.env.PANEL_GITHUB_TOKEN;
  delete process.env.CODER_GITHUB_TOKEN;
});

test("week starts on Saturday 00:00 UTC (Kaggle's quota reset)", () => {
  expect(new Date(weekStart(Date.parse("2026-10-21T13:00:00Z"))).toISOString()).toBe("2026-10-17T00:00:00.000Z");
  expect(new Date(weekStart(Date.parse("2026-10-24T00:00:01Z"))).toISOString()).toBe("2026-10-24T00:00:00.000Z");
  expect(new Date(weekStart(Date.parse("2026-10-23T23:59:59Z"))).toISOString()).toBe("2026-10-17T00:00:00.000Z");
});

test("keeps only notebook lines of a job log and sums the weekly GPU hours", () => {
  const log = [
    "2026-10-24T01:00:00.1Z pip install kaggle",
    "2026-10-24T01:00:02.1Z دفتر 1: كان COMPLETE — دُفعت نسخة جديدة (pushed)",
    "2026-10-24T01:00:03.1Z Nova 1: جلسة GPU الأسبوعية لدفتر شام انتهت (5.5 س) — تشغيلاته التالية هذا الأسبوع على CPU",
    "2026-10-24T01:00:04.1Z Nova 1: انتهت جلسته (COMPLETE، 10.9 س) — دفتر شام المحجوز يعود إلى إعادة التشغيل العادية",
  ].join("\n");
  const lines = statusLines(log);
  expect(lines).toHaveLength(3);
  expect(lines[0].startsWith("دفتر 1")).toBe(true);
  expect(gpuHours(lines)).toEqual({ sham: 5.5, nova: 10.9 });
});

test("panel ops are the owner's only", async () => {
  await expect(appOp({ chatId: 1, tier: "user" }, "panel", {}, { bot: {} as any, botRow: {} as any, db: fakeDb() } as any)).rejects.toMatchObject({ status: 403 });
  await expect(appOp({ chatId: 1, tier: "user" }, "panel_action", { action: "monitor_run" }, { bot: {} as any, botRow: {} as any, db: fakeDb() } as any)).rejects.toMatchObject({ status: 403 });
});

test("actions change nothing without a token, and pause edits only Nova 1's switch", async () => {
  expect((await panelAction("monitor_run")).ok).toBe(false);
  process.env.PANEL_GITHUB_TOKEN = "t";
  const calls: { url: string; init: any }[] = [];
  const file = { enabled: true, done: false };
  const f = (async (url: string, init: any = {}) => {
    calls.push({ url, init });
    if (!init.method) return new Response(JSON.stringify({ sha: "abc", content: Buffer.from(JSON.stringify(file)).toString("base64") }), { status: 200 });
    if (init.method === "PUT") return new Response("{}", { status: 200 });
    return new Response(null, { status: 204 });
  }) as any;
  const r = await panelAction("nova_pause", f);
  expect(r.ok).toBe(true);
  const put = calls.find((c) => c.init.method === "PUT")!;
  expect(put.url).toContain("/contents/training/nova1/kaggle/run_request.json");
  const sent = JSON.parse(put.init.body);
  expect(sent.branch).toBe("training/nova1");
  expect(JSON.parse(Buffer.from(sent.content, "base64").toString())).toEqual({ enabled: true, done: true });
  expect((await panelAction("monitor_run", f)).ok).toBe(true);
  expect(calls.at(-1)!.url).toContain("/actions/workflows/sham-restarter.yml/dispatches");
  expect((await panelAction("rm -rf", f)).ok).toBe(false);
});
