// Thinking, speed (accuracy) and media generation are per selected model; the owner's expose toggles per model; nothing leaks between models.
import { appOp, AppError } from "@/lib/coderApp";
import { handleCoderSections, loadState, shamContextFor } from "@/lib/coderSections";
import { modelSettings, setModelSettings, listModels, updateModel, publicModels } from "@/lib/coderModels";
import { fakeBot, fakeDb } from "./coderFakes";

const OWNER = 4242, USER = 9001;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const o = { chatId: OWNER, tier: "owner" as const }, u = { chatId: USER, tier: "user" as const };
beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.CODER_TOKEN_KEY = "test-key";
});

describe("independent routing while Nova's coder Studio is offline", () => {
  it("handles owner /start without routing the default Nova selection to Sham", async () => {
    const previous = process.env.OPEN_CODER_STUDIO_URL;
    delete process.env.OPEN_CODER_STUDIO_URL;
    try {
      const db = fakeDb();
      const { bot, sent } = fakeBot();
      const d = { db, bot, botRow };
      await appOp(o, "settings", { model: "coder" }, d);

      const handled = await handleCoderSections(bot, botRow, {
        message: { chat: { id: OWNER }, from: { id: OWNER }, text: "/start" },
      }, db);

      expect(handled).toBe(true);
      expect(sent.some((item) => item.text.includes("لم أرسل طلبك إلى شام"))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.OPEN_CODER_STUDIO_URL;
      else process.env.OPEN_CODER_STUDIO_URL = previous;
    }
  });

  it("does not silently route the owner's Nova-selected message through Sham", async () => {
    const previous = process.env.OPEN_CODER_STUDIO_URL;
    delete process.env.OPEN_CODER_STUDIO_URL;
    try {
      const db = fakeDb();
      const { bot, sent } = fakeBot();
      const d = { db, bot, botRow };
      await appOp(o, "settings", { model: "coder" }, d);

      const handled = await handleCoderSections(bot, botRow, {
        message: { chat: { id: OWNER }, from: { id: OWNER }, text: "اختبار مسار Nova" },
      }, db);

      expect(handled).toBe(true);
      expect(sent.some((item) => item.text.includes("لم أرسل طلبك إلى شام تلقائياً"))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.OPEN_CODER_STUDIO_URL;
      else process.env.OPEN_CODER_STUDIO_URL = previous;
    }
  });
});

const AUTO = { think: false, accuracy: "balanced", media: true, auto: true, policy: "adaptive" };
describe("modelSettings (pure): every model is automatic (owner 2026-11-22: no thinking / speed / media controls)", () => {
  it("defaults; a change changes nothing, for any model", () => {
    const st: any = {};
    expect(modelSettings(st, "coder")).toEqual(AUTO);
    expect(setModelSettings(st, "sham_v2", { think: true, accuracy: "precise", media: false })).toEqual(AUTO);
    for (const m of ["sham_v2", "sham", "coder"]) expect(modelSettings(st, m)).toEqual(AUTO);
    expect(st.perModel).toBeUndefined();                          // nothing is stored
  });
  it("stale stored values (old settings screens) are ignored: every model is thinking adaptive + accuracy balanced", () => {
    const st: any = { think: true, accuracy: "fast", perModel: { coder: { think: true, auto: false, media: false, policy: "always", accuracy: "precise" } } };
    for (const m of ["coder", "sham_v2"]) expect(modelSettings(st, m)).toEqual(AUTO);
  });
});

describe("Mini App settings op", () => {
  it("the settings requests of older clients are accepted and change nothing: me returns the automatic values for every model", async () => {
    const db = fakeDb(); const { bot } = fakeBot(); const d = { db, bot, botRow };
    await appOp(o, "settings", { model: "coder" }, d);
    await appOp(o, "settings", { think: true, accuracy: "fast", media: false }, d);
    await appOp(o, "settings", { model: "sham_v2" }, d);
    let me = await appOp(o, "me", {}, d);
    expect(me.settings).toMatchObject({ model: "sham_v2", think: false, accuracy: "balanced", media: true });
    await appOp(o, "settings", { think: true, accuracy: "precise" }, d);
    await appOp(o, "settings", { model: "coder" }, d);
    me = await appOp(o, "me", {}, d);
    expect(me.settings).toMatchObject({ model: "coder", think: false, accuracy: "balanced", media: true });
  });

  it("`for` edits another model's settings without switching to it", async () => {
    const db = fakeDb(); const { bot } = fakeBot(); const d = { db, bot, botRow };
    await appOp(o, "settings", { for: "sham", media: false }, d);
    const st = await loadState(OWNER, db);
    expect(modelSettings(st, "sham").media).toBe(true);        // the switch was removed: no request can turn media off
    expect(st.model ?? "coder").toBe("coder");
  });

  it("a user cannot edit a model that is not open to them; Nova is always allowed", async () => {
    const previous = process.env.MODELSCOPE_API_TOKEN;
    delete process.env.MODELSCOPE_API_TOKEN; // Sham is not ready, while Nova remains available to the user.
    try {
      const db = fakeDb(); const { bot } = fakeBot(); const d = { db, bot, botRow };
      await expect(appOp(u, "settings", { for: "sham_v2", think: true }, d)).rejects.toBeInstanceOf(AppError);
      await expect(appOp(u, "settings", { think: true }, d)).resolves.toMatchObject({ ok: true });
      expect(modelSettings(await loadState(USER, db), "coder").think).toBe(false);      // automatic: the request changes nothing
    } finally {
      if (previous === undefined) delete process.env.MODELSCOPE_API_TOKEN;
      else process.env.MODELSCOPE_API_TOKEN = previous;
    }
  });

  it("the runtime context carries the automatic values whatever an old client stored", async () => {
    const db = fakeDb(); const { bot } = fakeBot(); const d = { db, bot, botRow };
    await appOp(o, "settings", { for: "sham", think: false, accuracy: "fast", media: false }, d);
    await appOp(o, "settings", { for: "sham_v2", think: true, accuracy: "precise", media: true }, d);
    await appOp(o, "settings", { model: "sham" }, d);
    expect(await shamContextFor({ message: { chat: { id: OWNER } } }, db)).toMatchObject({ variant: "v1", mode: { think: false, accuracy: "balanced", media: true } });
    await appOp(o, "settings", { model: "sham_v2" }, d);
    expect(await shamContextFor({ message: { chat: { id: OWNER } } }, db)).toMatchObject({ variant: "v2", mode: { think: false, accuracy: "balanced", media: true } });
  });

  it("T-LDM is built into Sham Pro (no switch, no audience gate) and is never part of Sham 1", async () => {
    const db = fakeDb(); const { bot } = fakeBot(); const d = { db, bot, botRow };
    await appOp(o, "settings", { model: "sham_v2" }, d);
    // a plain user's chat and the owner's chat: both go through Sham Pro's own T-LDM, with nothing set
    expect(await shamContextFor({ message: { chat: { id: OWNER } } }, db)).toMatchObject({ variant: "v2", tldm: true, mode: { tldm: true } });
    expect(await shamContextFor({ message: { chat: { id: USER } } }, db, "sham_v2")).toMatchObject({ variant: "v2", tldm: true, mode: { tldm: true } });
    // turning it "off" from the app changes nothing
    await appOp(o, "settings", { tldm: false, for: "sham_v2" }, d);
    expect(await shamContextFor({ message: { chat: { id: OWNER } } }, db)).toMatchObject({ tldm: true });
    // Sham 1 never gets it
    expect(await shamContextFor({ message: { chat: { id: OWNER } } }, db, "sham")).toMatchObject({ variant: "v1", tldm: false, mode: { tldm: false } });
  });
});

function modelsDb(): any {
  const rows = new Map<string, any>();
  return {
    exec: async (sql: string, ...a: any[]) => { if (sql.includes("INSERT INTO coder_models")) rows.set(a[0], { id: a[0], data: JSON.parse(a[1]) }); return undefined; },
    query: async (sql: string) => (sql.includes("FROM coder_models") ? [...rows.values()] : []),
  };
}
describe("owner-only visibility with a per-model expose toggle", () => {
  it("Nova is public; Sham and Sham v2 are the owner's until each is switched on separately", async () => {
    const db = modelsDb();
    let all = await listModels(db);
    // Seed the intended initial visibility explicitly instead of relying on the legacy auto-rollout migration.
    await updateModel("sham", { visible: false }, db);
    await updateModel("sham_v2", { visible: false }, db);
    all = await listModels(db);
    expect(publicModels(all, undefined).map((m) => m.id)).toEqual(["coder"]);
    await updateModel("sham_v2", { visible: true }, db);
    all = await listModels(db);
    expect(publicModels(all, undefined).map((m) => m.id)).toEqual(["coder", "sham_v2"]);          // v2 exposed, old Sham still private
    await updateModel("sham", { visible: true }, db);
    expect(publicModels(await listModels(db), undefined).map((m) => m.id)).toEqual(["coder", "sham", "sham_v2"]);
    await updateModel("sham_v2", { visible: false }, db);
    expect(publicModels(await listModels(db), undefined).map((m) => m.id)).toEqual(["coder", "sham"]);
  });
  it("a regular user cannot flip the toggle (model_update is owner only)", async () => {
    const db = fakeDb(); const { bot } = fakeBot();
    await expect(appOp(u, "model_update", { id: "sham", visible: true }, { db, bot, botRow })).rejects.toBeInstanceOf(AppError);
  });
});

describe("media generation can never be switched off (any model, any stored value)", () => {
  it("a stored legacy false is ignored for every model; the app settings payload and the API cannot turn it off", async () => {
    const st: any = { perModel: { coder: { media: false }, sham: { media: false }, sham_v2: { media: false } } };
    for (const id of ["coder", "sham", "sham_v2"]) expect(modelSettings(st, id).media).toBe(true);
    for (const id of ["coder", "sham", "sham_v2"]) expect(setModelSettings(st, id, { media: false } as any).media).toBe(true);
  });
});
