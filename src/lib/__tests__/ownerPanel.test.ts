process.env.SUPER_ADMIN_TELEGRAM_ID = "9001";
const store: Record<string, unknown> = {};
jest.mock("@/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: (_c: string, k: string) => ({ maybeSingle: async () => ({ data: k in store ? { value: store[k] } : null }) }) }),
      upsert: async (row: { key: string; value: unknown }) => { store[row.key] = row.value; return {}; },
    }),
  }),
}));
import { ADMIN_VIEW_BTN, USER_VIEW_BTN, ownerGate, ownerInUserView, ownerPanelTransformer, setOwnerUserView, withSwitchRow } from "@/lib/ownerPanel";

describe("owner panel switch", () => {
  it("adds the switch row to a reply keyboard: user button in the admin view, admin button in the user view", () => {
    const kb = { keyboard: [[{ text: "📊 الإحصائيات" }]], resize_keyboard: true };
    expect(withSwitchRow(kb, false)).toEqual({ keyboard: [[{ text: "📊 الإحصائيات" }], [{ text: USER_VIEW_BTN }]], resize_keyboard: true });
    expect((withSwitchRow(kb, true) as any).keyboard.at(-1)).toEqual([{ text: ADMIN_VIEW_BTN }]);
  });
  it("leaves a keyboard that already has a switch button, inline keyboards and string buttons alone", () => {
    expect(withSwitchRow({ keyboard: [[{ text: ADMIN_VIEW_BTN }]] }, false)).toBeNull();
    expect(withSwitchRow({ keyboard: [[USER_VIEW_BTN]] }, true)).toBeNull();
    expect(withSwitchRow({ inline_keyboard: [[{ text: "x", callback_data: "y" }]] } as any, false)).toBeNull();
    expect((withSwitchRow({ keyboard: [["a"]] }, false) as any).keyboard).toEqual([["a"], [{ text: USER_VIEW_BTN }]]);
  });
  it("the mode is per bot, defaults to the admin view, and flips with the buttons (re-entering with /start)", async () => {
    expect(await ownerInUserView("b1")).toBe(false);
    const reenter = jest.fn(async () => undefined);
    expect(await ownerGate("b1", "ما", reenter)).toBe("admin");
    expect(await ownerGate("b1", USER_VIEW_BTN, reenter)).toBe("handled");
    expect(reenter).toHaveBeenCalledWith("/start");
    expect(await ownerInUserView("b1")).toBe(true);
    expect(await ownerGate("b1", "ما", reenter)).toBe("user");
    expect(await ownerInUserView("b2")).toBe(false); // another bot is not affected
    expect(await ownerGate("b1", ADMIN_VIEW_BTN, reenter)).toBe("handled");
    expect(await ownerGate("b1", "ما", reenter)).toBe("admin");
    await setOwnerUserView("b3", true);
    expect(store["owner_user_view:b3"]).toBe(true);
  });
  it("the transformer touches only reply keyboards sent to the owner's chat", async () => {
    await setOwnerUserView("b4", false);
    const seen: any[] = [];
    const prev: any = async (_m: string, p: any) => { seen.push(p); return { ok: true }; };
    const t = ownerPanelTransformer("b4") as any;
    await t(prev, "sendMessage", { chat_id: 9001, text: "x", reply_markup: { keyboard: [["a"]] } }, undefined);
    await t(prev, "sendMessage", { chat_id: 1234, text: "x", reply_markup: { keyboard: [["a"]] } }, undefined);
    await t(prev, "sendMessage", { chat_id: 9001, text: "x", reply_markup: { inline_keyboard: [[{ text: "x", callback_data: "y" }]] } }, undefined);
    await t(prev, "sendPhoto", { chat_id: 9001, reply_markup: { keyboard: [["a"]] } }, undefined);
    expect(seen[0].reply_markup.keyboard.at(-1)).toEqual([{ text: USER_VIEW_BTN }]);
    expect(seen[1].reply_markup.keyboard).toEqual([["a"]]);
    expect(seen[2].reply_markup.inline_keyboard).toBeDefined();
    expect(seen[3].reply_markup.keyboard).toEqual([["a"]]);
  });
});
