// The live feed the Mini App chat follows: the SSE route's frames, the app's own frame parser, and the merge helper that
// folds streamed events into the task list the chat already shows. This is the contract streaming depends on — if it drifts,
// the answer stops arriving live and nobody notices until a user complains.
//
// The route reads through prismaDb, which this suite cannot inject, so the route test stubs the task store (as
// terminalVisibility.test.ts does) and checks the wire format; the merge/reconnect behaviour is checked against the REAL
// SQL engine directly, which is where the interesting dedup and cursor logic lives.
import { NextRequest } from "next/server";
import { taskStart, taskEvent } from "@/lib/coderTasks";
import { mergeTaskEvents, splitSseFrames, sseFrameData, lastEventId } from "@/lib/liveEvents";
import { pgDb, resetPg } from "./pgDb";

jest.setTimeout(30000);

const OWNER = 4242;
const streamed = [
  { id: 1, run_id: "run-1", kind: "start", text: "سؤال" },
  { id: 2, run_id: "run-1", kind: "text", text: "جزء " },
  { id: 3, run_id: "run-1", kind: "text", text: "ثانٍ" },
  { id: 4, run_id: "run-1", kind: "done", text: "" },
];

jest.mock("@/lib/prisma", () => ({ prisma: { bot: { findUnique: jest.fn(async () => ({ id: "b", token: "T" })), findFirst: jest.fn(async () => ({ id: "b", token: "T" })) } } }));
jest.mock("@/lib/tmaInitData", () => ({ verifyTmaInitData: jest.fn((h: string) => (h.startsWith("u") ? { id: Number(h.slice(1)) } : null)) }));
jest.mock("@/lib/coderPlans", () => ({ terminalAllowed: jest.fn(async () => true) }));
jest.mock("@/lib/coderAuth", () => ({ ...jest.requireActual("@/lib/coderAuth"), prismaDb: {} }));   // keep the real coderChatKey: the task rows are keyed by it
jest.mock("@/lib/coderTasks", () => ({
  ...jest.requireActual("@/lib/coderTasks"),                     // keep the real isTaskModelFilter / TASK_MODEL_FILTERS
  // After the cursor: only the events the client has not seen. The last one is `done`, so the route closes the stream.
  taskEvents: jest.fn(async (_u: number, _run: string, after: number) => streamed.filter((e) => e.id > after)),
}));

/** Read the SSE body until the route closes it, decoding whole frames only (a frame split across reads stays in the buffer). */
async function readStream(body: ReadableStream<Uint8Array> | null, limitMs = 8000): Promise<string[]> {
  const frames: string[] = [];
  const reader = body?.getReader();
  if (!reader) return frames;
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { frames: whole, rest } = splitSseFrames(buffer);
    buffer = rest;
    frames.push(...whole);
  }
  await reader.cancel().catch(() => undefined);
  return frames;
}

describe("the live chat feed", () => {
  it("the SSE route writes the app's own frame format, in id order, and closes on `done`", async () => {
    const { GET } = await import("@/app/api/coder/stream/route");
    const response = await GET(new NextRequest("https://x.test/api/coder/stream?runId=run-1&after=0", { headers: { "x-telegram-init-data": "u4242" } }));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = (await readStream(response.body)).map(sseFrameData).filter((e): e is NonNullable<typeof e> => Boolean(e));
    expect(events.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    expect(events.filter((e) => e.kind === "text").map((e) => e.text).join("")).toBe("جزء ثانٍ");
  });

  it("a reconnect passes `after` so the route replays only the gap", async () => {
    const { GET } = await import("@/app/api/coder/stream/route");
    const response = await GET(new NextRequest("https://x.test/api/coder/stream?runId=run-1&after=2", { headers: { "x-telegram-init-data": "u4242" } }));
    const events = (await readStream(response.body)).map(sseFrameData).filter((e): e is NonNullable<typeof e> => Boolean(e));
    expect(events.map((e) => e.id)).toEqual([3, 4]);                 // 1 and 2 are not sent again
    const tasks = (await import("@/lib/coderTasks")).taskEvents as jest.Mock;
    expect(tasks).toHaveBeenCalledWith(OWNER, "run-1", 2, expect.anything(), undefined);
  });

  it("the merge folds real streamed events into the loaded list: dedup by id, same array when nothing is new", async () => {
    const db: any = pgDb();
    await resetPg();
    const runId = "run-merge-1";
    await taskStart(OWNER, { runId, slot: "", source: "interactive", title: "سؤال" }, db);
    await taskEvent(runId, "text", "أ", db);
    await taskEvent(runId, "text", "ب", db);

    // What the chat view holds: the `thread` op pairs each task row with its events (listTasks itself returns rows only).
    // The route test above stubs taskEvents, so read the real rows/events here.
    const real = jest.requireActual<typeof import("@/lib/coderTasks")>("@/lib/coderTasks");
    const loaded = await real.listTasks(OWNER, {}, db);
    const events = await real.taskEvents(OWNER, runId, 0, db);
    const shown = loaded.map((t: any) => (t.run_id === runId ? { ...t, events } : t));

    const once = mergeTaskEvents(shown, runId, events);
    expect(once).toBe(shown);                                        // the poll already had these ids: no new render
    const extra = mergeTaskEvents(shown, runId, [{ id: 9999, run_id: runId, kind: "text", text: "ج", created_at: new Date().toISOString() } as any]);
    expect(extra).not.toBe(shown);
    expect(extra.find((t: any) => t.run_id === runId)?.events.map((e: any) => e.text)).toEqual(["سؤال", "أ", "ب", "ج"]);
  });

  it("the reconnect cursor is the highest id the chat has seen for that run", async () => {
    expect(lastEventId([{ run_id: "r", events: [{ id: 3 }, { id: 7 }, { id: 5 }] } as any], "r")).toBe(7);
    expect(lastEventId([], "r")).toBe(0);
    expect(lastEventId([{ run_id: "other", events: [{ id: 9 }] } as any], "r")).toBe(0);   // another run's ids never leak in
  });
});
