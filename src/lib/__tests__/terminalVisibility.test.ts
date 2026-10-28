// The terminal is for the owner and paid plans ONLY; free users keep a plain chat (no terminal tab, the terminal API refuses). Within that, everything is keyed by the verified user id.
import { NextRequest } from "next/server";

const PAID = new Set([1, 2]);                                        // 1 = owner, 2 = a Plus user; 3 = free
jest.mock("@/lib/prisma", () => ({ prisma: { bot: { findUnique: jest.fn(async () => ({ id: "b", token: "T" })), findFirst: jest.fn(async () => ({ id: "b", token: "T" })) } } }));
jest.mock("@/lib/tmaInitData", () => ({ verifyTmaInitData: jest.fn((h: string) => (h.startsWith("u") ? { id: Number(h.slice(1)) } : null)) }));
jest.mock("@/lib/coderPlans", () => ({ terminalAllowed: jest.fn(async (id: number) => PAID.has(Number(id))) }));
jest.mock("@/lib/coderTasks", () => ({
  listTasks: jest.fn(async (id: number) => [{ run_id: `run-of-${id}`, status: "running" }]),
  taskEvents: jest.fn(async (id: number, runId: string) => (runId === `run-of-${id}` ? [{ id: 1, run_id: runId, kind: "text", text: `سري ${id}` }] : [])),
}));
jest.mock("@/lib/coderSections", () => ({ loadState: jest.fn(async () => ({ run: null })) }));
jest.mock("@/lib/coderAuth", () => ({ prismaDb: {} }));

const call = async (mod: string, user: string, qs = "") => {
  const { GET } = await import(mod);
  const r = await GET(new NextRequest(`https://x.test/api/coder/${mod.includes("stream") ? "stream" : "terminal"}${qs}`, { headers: { "x-telegram-init-data": user } }));
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

describe("terminal visibility", () => {
  it("a free user gets 403 + hidden from the terminal feed and the stream", async () => {
    for (const m of ["@/app/api/coder/terminal/route", "@/app/api/coder/stream/route"]) {
      const r = await call(m, "u3", "?runId=run-of-1");
      expect(r.status).toBe(403);
      expect(r.body.hidden).toBe(true);
    }
  });
  it("a visitor without verified Telegram data gets 401, never a list", async () => {
    expect((await call("@/app/api/coder/terminal/route", "nobody")).status).toBe(401);
  });
  it("the owner and a paid user get the terminal — each only their own tasks and events", async () => {
    const owner = await call("@/app/api/coder/terminal/route", "u1");
    const plus = await call("@/app/api/coder/terminal/route", "u2");
    expect(owner.status).toBe(200);
    expect(owner.body.tasks.map((t: any) => t.run_id)).toEqual(["run-of-1"]);
    expect(plus.body.tasks.map((t: any) => t.run_id)).toEqual(["run-of-2"]);
    const peek = await call("@/app/api/coder/terminal/route", "u2", "?runId=run-of-1");      // the paid user asks for the owner's run id
    expect(peek.body.events).toEqual([]);
    const own = await call("@/app/api/coder/terminal/route", "u2", "?runId=run-of-2");
    expect(own.body.events[0].text).toBe("سري 2");
  });
});
