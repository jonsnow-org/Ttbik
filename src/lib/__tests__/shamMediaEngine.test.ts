// Each Sham model has its OWN media engine (owner panel «ماذا يستخدم كل نموذج لتوليد الوسائط؟»), not one global route: Sham v2 on ready weights while the old Sham stays on its own choice.
import { shamEngine, setShamEngine, targetOf } from "@/lib/shamMediaEngine";
import { probeStudio, mediaEngineStatus } from "@/lib/mediaEngines";
import { appOp, AppError } from "@/lib/coderApp";
import { pgDb, resetPg } from "./pgDb";
import { fakeBot } from "./coderFakes";

beforeEach(async () => { await resetPg(); process.env.SUPER_ADMIN_TELEGRAM_ID = "4242"; process.env.MODELSCOPE_API_TOKEN = "t"; process.env.SHAM_V2_OVERFLOW_URL = "off"; });

describe("per-model media engine", () => {
  it("defaults keep what happened before: Sham v2 on ready weights, the old Sham borrowing Sham v2's ready weights", async () => {
    const db: any = pgDb();
    expect(await shamEngine("sham_v2", db)).toBe("ready");
    expect(await shamEngine("sham", db)).toBe("borrow_v2");
    expect(targetOf("sham", "borrow_v2")).toEqual({ route: "sham_v2_ready", variant: "v2", backend: "ready" });
    expect(targetOf("sham", "internal")).toEqual({ route: "sham_v1", variant: "v1", backend: "internal" });
    expect(targetOf("sham_v2", "internal")).toEqual({ route: "sham_v2_internal", variant: "v2", backend: "internal" });
  });
  it("choices are stored per model and cannot cross over", async () => {
    const db: any = pgDb();
    await setShamEngine("sham_v2", "internal", db);
    expect(await shamEngine("sham_v2", db)).toBe("internal");
    expect(await shamEngine("sham", db)).toBe("borrow_v2");
    await expect(setShamEngine("sham_v2", "borrow_v2", db)).rejects.toThrow();
    await expect(setShamEngine("sham", "ready", db)).rejects.toThrow();
  });
  it("the owner op sets it; a user is refused", async () => {
    const db: any = pgDb(); const { bot } = fakeBot();
    const d: any = { db, bot, botRow: { id: "b", token: "T", webhookSecret: "w", isActive: true, template: "NOVA_BOT" } };
    expect(await appOp({ chatId: 4242, tier: "owner" }, "media_engine", { model: "sham_v2", engine: "internal" }, d)).toEqual({ model: "sham_v2", engine: "internal" });
    await expect(appOp({ chatId: 1, tier: "user" }, "media_engine", { model: "sham_v2", engine: "ready" }, d)).rejects.toThrow(AppError);
    await expect(appOp({ chatId: 4242, tier: "owner" }, "media_engine", { model: "coder", engine: "ready" }, d)).rejects.toThrow(AppError);
    await expect(appOp({ chatId: 1, tier: "user" }, "media_status", {}, d)).rejects.toThrow(AppError);
  });
  it("status: probes each Studio's own status and reports which Studio makes what", async () => {
    const f = (async (url: string, init?: any) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ event_id: "e" }), { status: 200 });
      const down = String(url).includes("sham-v1-server");
      return new Response(`event: complete\ndata: [${JSON.stringify(JSON.stringify({ phase: down ? "loading models" : "ready" }))}]\n`, { status: 200 });
    }) as unknown as typeof fetch;
    process.env.NOVA_MEDIA_STUDIO_URL = "https://studio-novaai2026-nova-media-server.api-inference.modelscope.net";
    const r = await mediaEngineStatus(pgDb() as any, f);
    const by = Object.fromEntries(r.models.map((m) => [m.id, m]));
    expect(by.coder.options).toEqual([]);
    expect(by.coder.studios[0]).toMatchObject({ id: "nova-media-server", ok: true });
    expect(by.coder.lines.every((l) => l.studio === "nova-media-server")).toBe(true);
    expect(by.sham_v2.lines.find((l) => l.kind === "video")?.studio).toBe("sham-v2-video-server");
    expect(by.sham_v2.studios.map((s) => s.id)).toEqual(["sham-v2-server", "sham-v2-video-server"]);
    expect(JSON.stringify(by.coder)).not.toMatch(/sham/i);                           // Nova never touches a Sham Studio
    expect(by.sham.engine).toBe("borrow_v2");
    expect(await probeStudio("", "t", f)).toMatchObject({ ok: false, phase: "off" });
    expect(await probeStudio("https://x.test", "t", (async () => { throw new Error("boom"); }) as any)).toMatchObject({ ok: false, phase: "down" });
  });
});
