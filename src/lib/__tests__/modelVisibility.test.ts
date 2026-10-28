// The owner's visibility switch is REAL: toggling «إظهار شام v2 لجميع المستخدمين» exposes / hides the model for a non-owner in the Mini App (model list, model pick,
// per-model settings) AND in the bot (a chat left on a hidden Sham goes back to Nova); the owner always has access; a model that is not ready never reaches others.
import { appOp, AppError } from "@/lib/coderApp";
import { handleCoderSections, loadState, saveState } from "@/lib/coderSections";
import { listModels, modelUsableBy } from "@/lib/coderModels";
import { fakeBot } from "./coderFakes";
import { pgDb, resetPg } from "./pgDb";

const OWNER = 4242, USER = 9001;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const o = { chatId: OWNER, tier: "owner" as const }, u = { chatId: USER, tier: "user" as const };
beforeEach(async () => {
  await resetPg();
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_TOKEN_KEY = "test-key";
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
});
const setup = () => { const db: any = pgDb(); const { bot } = fakeBot(); return { db, bot, d: { db, bot, botRow } }; };
const visibleTo = async (who: typeof o | typeof u, d: any) => ((await appOp(who, "models", {}, d)).models as any[]).map((m) => m.id);
let uid = 100;
const botSees = async (bot: any, db: any, model: "sham" | "sham_v2") => {
  const st = await loadState(USER, db);
  st.model = model; st.mode = "sham";
  await saveState(USER, st, db);
  await handleCoderSections(bot, botRow, { update_id: ++uid, message: { message_id: uid, chat: { id: USER }, from: { id: USER, first_name: "U" }, text: "/mode" } }, db);
  return loadState(USER, db);
};

describe("per-model visibility switch (owner panel) reaches the Mini App and the bot", () => {
  it("Mini App: hidden by default, exposed by the switch, hidden again by the switch; the owner always sees every model", async () => {
    const { d } = setup();
    expect(await visibleTo(u, d)).toEqual(["coder"]);
    expect(await visibleTo(o, d)).toEqual(["coder"]);                        // the public list; the owner's full list is below
    expect(((await appOp(o, "models", {}, d)).owner as any[]).map((m) => [m.id, m.access])).toEqual([["coder", "everyone"], ["sham", "owner_only"], ["sham_v2", "owner_only"]]);
    await expect(appOp(u, "settings", { model: "sham_v2" }, d)).rejects.toThrow(AppError);          // a user cannot pick it
    await appOp(o, "settings", { model: "sham_v2" }, d);                     // the owner can, hidden or not
    expect((await loadState(OWNER, d.db)).model).toBe("sham_v2");

    await appOp(o, "model_update", { id: "sham_v2", visible: true }, d);     // the switch «إظهار شام v2 لجميع المستخدمين»
    expect(await visibleTo(u, d)).toEqual(["coder", "sham_v2"]);             // Sham (old) stays hidden: switches are per model
    expect(((await appOp(o, "models", {}, d)).owner as any[]).find((m) => m.id === "sham_v2").access).toBe("everyone");
    await appOp(u, "settings", { model: "sham_v2" }, d);                     // now a user can pick it
    expect((await loadState(USER, d.db)).model).toBe("sham_v2");
    await expect(appOp(u, "settings", { model: "sham" }, d)).rejects.toThrow(AppError);

    await appOp(o, "model_update", { id: "sham_v2", visible: false }, d);    // and back
    expect(await visibleTo(u, d)).toEqual(["coder"]);
    await expect(appOp(u, "settings", { model: "sham_v2" }, d)).rejects.toThrow(AppError);
    expect(await visibleTo(o, d)).toEqual(["coder"]);
    await appOp(o, "settings", { model: "sham_v2" }, d);                     // the owner still can
    await expect(appOp(u, "model_update", { id: "sham_v2", visible: true }, d)).rejects.toThrow(AppError);   // only the owner has the switch
  });

  it("Mini App: switched on but not ready (no Studio token) is reported to the owner and still hidden from users", async () => {
    const { d } = setup();
    await appOp(o, "model_update", { id: "sham", visible: true }, d);
    delete process.env.MODELSCOPE_API_TOKEN;
    expect(await visibleTo(u, d)).toEqual(["coder"]);
    expect(((await appOp(o, "models", {}, d)).owner as any[]).find((m) => m.id === "sham").access).toBe("on_but_not_ready");
    const all = await listModels(d.db);
    expect(modelUsableBy(all.find((m) => m.id === "sham")!, true)).toBe(true);        // the owner is never blocked
    expect(modelUsableBy(all.find((m) => m.id === "sham")!, false)).toBe(false);
  });

  it("bot: a user left on Sham v2 is returned to Nova while it is hidden, and keeps Sham v2 once the owner exposes it", async () => {
    const { db, bot, d } = setup();
    let st = await botSees(bot, db, "sham_v2");
    expect(st.mode).toBe("coder");
    expect(st.model).toBeUndefined();
    await appOp(o, "model_update", { id: "sham_v2", visible: true }, d);
    st = await botSees(bot, db, "sham_v2");
    expect(st.model).toBe("sham_v2");
    expect(st.mode).toBe("sham");
    st = await botSees(bot, db, "sham");
    expect(st.mode).toBe("coder");
    await appOp(o, "model_update", { id: "sham_v2", visible: false }, d);
    st = await botSees(bot, db, "sham_v2");
    expect(st.mode).toBe("coder");
  });

  it("bot: the owner is never moved off Sham v2", async () => {
    const { db, bot } = setup();
    const st = await loadState(OWNER, db);
    st.model = "sham_v2"; st.mode = "sham";
    await saveState(OWNER, st, db);
    await handleCoderSections(bot, botRow, { update_id: 2, message: { message_id: 2, chat: { id: OWNER }, from: { id: OWNER, first_name: "O" }, text: "/mode" } }, db);
    const after = await loadState(OWNER, db);
    expect([after.model, after.mode]).toEqual(["sham_v2", "sham"]);
  });

  // each of the three models has its own «متاح لجميع المستخدمين / مخفي» switch: model_update { id, visible }
  describe.each(["coder", "sham", "sham_v2"] as const)("switch of %s", (id) => {
    it("Mini App: hiding removes it for a user (list, pick, send), exposing brings it back; the owner is never blocked; others are unaffected", async () => {
      const { d } = setup();
      const others = ["coder", "sham", "sham_v2"].filter((x) => x !== id);
      await appOp(o, "model_update", { id: "sham", visible: true }, d);
      await appOp(o, "model_update", { id: "sham_v2", visible: true }, d);       // start from everything available
      await appOp(o, "model_update", { id, visible: true }, d);
      expect(await visibleTo(u, d)).toContain(id);
      expect(((await appOp(o, "models", {}, d)).owner as any[]).find((m) => m.id === id).access).toBe("everyone");
      await appOp(o, "model_update", { id, visible: false }, d);                 // «مخفي»
      const list = await visibleTo(u, d);
      expect(list).not.toContain(id);
      for (const x of others) expect(list).toContain(x);                         // switches are per model
      expect(((await appOp(o, "models", {}, d)).owner as any[]).find((m) => m.id === id).access).toBe("owner_only");
      await expect(appOp(u, "settings", { model: id }, d)).rejects.toThrow(AppError);
      await appOp(o, "settings", { model: id }, d);                              // the owner always has access
      expect((await loadState(OWNER, d.db)).model).toBe(id);
      await expect(appOp(u, "model_update", { id, visible: true }, d)).rejects.toThrow(AppError);
      await appOp(o, "model_update", { id, visible: true }, d);                  // «متاح لجميع المستخدمين»
      await appOp(u, "settings", { model: id }, d);
      expect((await loadState(USER, d.db)).model).toBe(id);
    });
  });

  it("Mini App send: with every model hidden a user is refused", async () => {
    const { d } = setup();
    await appOp(o, "model_update", { id: "coder", visible: false }, d);
    expect(await visibleTo(u, d)).toEqual([]);
    await expect(appOp(u, "send", { text: "مرحبا" }, d)).rejects.toThrow(/model not available/);
  });

  it("bot: Nova hidden by the owner answers nobody but the owner; users moved to an exposed model; Nova back on = no lock message", async () => {
    const { db, bot, d } = setup();
    const sent: string[] = [];
    (bot.api.sendMessage as jest.Mock).mockImplementation(async (_c: number, t: string) => { sent.push(t); return { message_id: sent.length }; });
    await appOp(o, "model_update", { id: "coder", visible: false }, d);
    await handleCoderSections(bot, botRow, { update_id: 900, message: { message_id: 1, chat: { id: USER }, from: { id: USER, first_name: "U" }, text: "مرحبا" } }, db);
    expect(sent.some((t) => /غير متاح للمستخدمين/.test(t))).toBe(true);
    await appOp(o, "model_update", { id: "sham_v2", visible: true }, d);            // another model is open: the user is moved there, not locked out
    sent.length = 0;
    const st = await loadState(USER, db);
    st.model = undefined; st.mode = "coder";
    await saveState(USER, st, db);
    await handleCoderSections(bot, botRow, { update_id: 901, message: { message_id: 2, chat: { id: USER }, from: { id: USER, first_name: "U" }, text: "/mode" } }, db);
    const after = await loadState(USER, db);
    expect([after.model, after.mode]).toEqual(["sham_v2", "sham"]);
    expect(sent.some((t) => /غير متاح للمستخدمين/.test(t))).toBe(false);
  });
});
