// OPT-IN end-to-end run of Nova's real agent loop against a REAL local Nova Studio (llama.cpp + Qwen3.5-4B GGUF on CPU, ai-system/modelscope-coder/app.py).
// Not part of the normal suite: set NOVA_E2E=1 NOVA_E2E_URL=http://127.0.0.1:7870 (optionally NOVA_E2E_TASK=coding|research|long). No mocks of the model, the tools or the network.
import { drive, loadState, saveState } from "@/lib/coderSections";
import { taskEvents, listTasks } from "@/lib/coderTasks";
import { fakeBot, fakeDb } from "./coderFakes";

const RUN = process.env.NOVA_E2E === "1";
const CHAT = 4242;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const TASKS: Record<string, { prompt: string; budgetMs: number; expect: RegExp }> = {
  coding: {
    prompt: "اكتب دالة JavaScript اسمها isPrime(n) ثم شغّلها في الـ sandbox على الأعداد 1 و2 و17 و18 و97 واعرض النتائج الفعلية للتشغيل.",
    budgetMs: 25 * 60_000, expect: /17|97/,
  },
  research: {
    prompt: "ابحث في الويب عن آخر إصدار مستقر من Node.js وأعطني رقمه مع مصدر الخبر.",
    budgetMs: 20 * 60_000, expect: /\d+\.\d+/,
  },
  long: {
    prompt: "نفّذ مهمة من عدة خطوات: (1) في الـ sandbox اكتب ملف JS فيه دالة fib(n) و دالة isPrime(n) (2) شغّل fib(20) وأول 10 أعداد أولية (3) اكتب لي تقريراً قصيراً بالنتائج الفعلية.",
    budgetMs: 40 * 60_000, expect: /6765/,
  },
};
const which = process.env.NOVA_E2E_TASK || "coding";
(RUN ? describe : describe.skip)(`Nova real e2e: ${which}`, () => {
  jest.setTimeout(60 * 60_000);
  it("runs the task to the end with the real model and real tools", async () => {
    process.env.OPEN_CODER_STUDIO_URL = process.env.NOVA_E2E_URL || "http://127.0.0.1:7870";
    process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT);
    process.env.CODER_TOKEN_KEY = "test-key";
    process.env.CODER_POLL_MS = "1500";
    const t = TASKS[which];
    const db = fakeDb();
    const { bot, sent } = fakeBot();
    const st = await loadState(CHAT, db);
    st.messages = [{ role: "user", content: t.prompt }] as any;
    st.run = { id: "e2e1", chain: "c", sent: 0, step: 0, lease: Date.now(), source: "interactive", slot: "", goal: t.prompt } as any;
    await saveState(CHAT, st, db);
    const t0 = Date.now();
    let chain = "c";
    for (let i = 0; i < 400; i++) {
      await drive(bot, botRow, CHAT, chain, db, t.budgetMs);   // one long budget: no hand-off to the /api/coder/continue route (there is no Next server here)
      const cur = await loadState(CHAT, db);
      if (!cur.run) break;
      chain = cur.run.chain;
      if (Date.now() - t0 > t.budgetMs) break;
    }
    const fin = await loadState(CHAT, db);
    const events = (db as any).t?.events || [];
    const log = events.map((e: any) => `${e.kind}: ${String(e.text).slice(0, 300)}`);
    const tools = (fin.messages as any[]).filter((m) => m.role === "tool").map((m) => `TOOL RESULT: ${String(m.content).slice(0, 500)}`);
    const out = sent.map((s: any) => String(s.text));
    // eslint-disable-next-line no-console
    console.log(`[nova-e2e ${which}] ${Math.round((Date.now() - t0) / 1000)}s, run finished: ${!fin.run}\n--- steps\n${log.join("\n")}\n--- tool results\n${tools.join("\n")}\n--- replies\n${out.join("\n=====\n")}`);
    expect(fin.run).toBeNull();
    expect(out.join("\n")).toMatch(t.expect);
    void taskEvents; void listTasks;
  });
});
