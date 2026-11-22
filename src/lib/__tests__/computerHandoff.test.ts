// Every model can hand ITS OWN computer screen to the user (sign-in, code, captcha) and get it back. Proven on a real SQL engine and the real app dispatcher.
import { cleanHandoff, handoffDoneNote, handoffEvent, parseScreenEvent, shamHandoffFollowup, HANDOFF_TOOL_NAME } from "@/lib/computerHandoff";
import { taskStart, taskEvent, latestScreenOffer } from "@/lib/coderTasks";
import { DESKTOP_TOOL_DEFS } from "@/lib/coderAgent";
import { SHAM_TOOLS } from "@/lib/shamExec";
import { appOp } from "@/lib/coderApp";
import { pgDb, resetPg } from "./pgDb";

const OWNER = 4243;
const db = (): any => pgDb();
beforeEach(async () => { await resetPg(); });

describe("computer handoff", () => {
  test("arguments are bounded; an unknown kind is 'other'; an empty reason is refused", () => {
    expect(cleanHandoff({ kind: "signin", reason: "  سجّل دخولك إلى GitHub  " })).toEqual({ kind: "signin", reason: "سجّل دخولك إلى GitHub" });
    expect(cleanHandoff({ kind: "hack", reason: "x" })?.kind).toBe("other");
    expect(cleanHandoff({ kind: "code" })).toBeNull();
    expect(cleanHandoff({ reason: "y".repeat(999) })?.reason.length).toBe(240);
  });

  test("the model is told to look at the screen again; a cancel says not to retry", () => {
    expect(handoffDoneNote({ kind: "captcha", reason: "r" })).toMatch(/Look at the screen again/);
    expect(handoffDoneNote(null, "", true)).toMatch(/did NOT do it/);
    expect(shamHandoffFollowup({ kind: "signin", reason: "ادخل" })).toMatch(/^\[الحاسوب\]/);
  });

  test("Nova and Sham both get the tool, in their own tool lists", () => {
    expect(DESKTOP_TOOL_DEFS.some((t) => t.function.name === HANDOFF_TOOL_NAME)).toBe(true);
    expect(SHAM_TOOLS.some((t) => t.function.name === HANDOFF_TOOL_NAME)).toBe(true);
  });

  test("screen events round-trip; a Nova handoff carries its run, a Sham one resumes by chat", () => {
    expect(parseScreenEvent(handoffEvent("coder", { kind: "code", reason: "r" }, "run", "s:1"))).toEqual({ model: "coder", handoff: { kind: "code", reason: "r" }, resume: "run", slot: "s:1" });
    expect(parseScreenEvent(handoffEvent("sham_v2", { kind: "code", reason: "r" }, "chat"))).toEqual({ model: "sham_v2", handoff: { kind: "code", reason: "r" }, resume: "chat" });
    expect(parseScreenEvent("{bad")).toBeNull();
  });

  test("a Nova handoff is offered (with its run id); a plain Nova show still is not; another chat never sees it", async () => {
    await taskStart(OWNER, { runId: "run-hand-1", slot: "", title: "t", source: "interactive" }, db());
    await taskEvent("run-hand-1", "screen", JSON.stringify({ model: "coder" }), db());
    expect(await latestScreenOffer(OWNER, db())).toBeNull();
    await taskEvent("run-hand-1", "screen", handoffEvent("coder", { kind: "signin", reason: "سجّل دخولك" }, "run", ""), db());
    expect(await latestScreenOffer(OWNER, db())).toMatchObject({ model: "coder", handoff: { kind: "signin" }, resume: "run", runId: "run-hand-1", slot: "" });
    expect(await latestScreenOffer(OWNER + 1, db())).toBeNull();
    await taskEvent("run-hand-1", "screen", handoffEvent("sham_v2", { kind: "captcha", reason: "حل التحقق" }, "chat"), db());
    const sham = await latestScreenOffer(OWNER, db());
    expect(sham).toMatchObject({ model: "sham_v2", resume: "chat" });
    expect(sham?.runId).toBeUndefined();
  });

  test("handoff_done: Sham gets a follow-up; a Nova run that is not waiting is refused", async () => {
    const user = { chatId: OWNER, tier: "owner" } as any;
    const r = await appOp(user, "handoff_done", { model: "sham_v2", handoff: { kind: "signin", reason: "ادخل" } }, { db: db() } as any);
    expect(String(r.followup)).toMatch(/انتهيت/);
    const c = await appOp(user, "handoff_done", { model: "sham", cancel: true }, { db: db() } as any);
    expect(String(c.followup)).toMatch(/لم أنفّذ/);
    await expect(appOp(user, "handoff_done", { runId: "run-none" }, { db: db() } as any)).rejects.toThrow(/no computer handoff/);
  });
});
