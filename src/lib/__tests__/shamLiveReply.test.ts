import { createShamTypist, finalizeShamEdit, mergeResumedStream, isRetryableStreamError, _resetShamLiveReply } from "@/lib/shamLiveReply";

const botWith = (api: Record<string, unknown>) => ({ api } as any);

beforeEach(() => { _resetShamLiveReply(); delete process.env.SHAM_LIVE_DRAFT; delete process.env.CODER_LIVE_DRAFT; });

describe("mergeResumedStream", () => {
  it("keeps a replayed prefix and appends only the new tail", () => {
    expect(mergeResumedStream("أهلاً ", "أهلاً بك")).toBe("أهلاً بك");
    expect(mergeResumedStream("أهلاً بك", "أهلاً ")).toBe("أهلاً بك");
    expect(mergeResumedStream("أهلاً ", "بك")).toBe("أهلاً بك");
    expect(mergeResumedStream("", "أهلاً")).toBe("أهلاً");
  });
});

describe("isRetryableStreamError", () => {
  it("retries timeouts and network blips, not a missing event", () => {
    expect(isRetryableStreamError(Object.assign(new Error("aborted"), { name: "TimeoutError" }))).toBe(true);
    expect(isRetryableStreamError(Object.assign(new Error("fetch failed"), { name: "TypeError" }))).toBe(true);
    expect(isRetryableStreamError(new Error("HTTP 503"))).toBe(true);
    expect(isRetryableStreamError(new Error("HTTP 404"))).toBe(false);
  });
});

describe("createShamTypist", () => {
  it("streams through sendMessageDraft and throttles updates", async () => {
    const calls: string[] = [];
    let t = 1_000;
    const typist = createShamTypist(botWith({
      sendMessageDraft: jest.fn(async (_chat: number, _id: number, text: string) => { calls.push(text); }),
    }), 9, { minIntervalMs: 1500, now: () => t });
    typist.push("أه");
    await typist.flush();
    typist.push("أهلاً");
    await new Promise((r) => setImmediate(r));   // auto-flush respects the interval
    expect(calls).toEqual(["أه"]);
    t += 1500;
    await typist.flush();
    expect(calls).toEqual(["أه", "أهلاً"]);
    const done = await typist.finish();
    expect(done.mode).toBe("draft");
    expect(done.text).toBe("أهلاً");
  });

  it("falls back to a growing message when drafts are refused, and finish stays on that message", async () => {
    const edits: string[] = [];
    const typist = createShamTypist(botWith({
      sendMessageDraft: jest.fn(async () => { throw new Error("not supported"); }),
      sendMessage: jest.fn(async (_chat: number, text: string) => { edits.push(`send:${text}`); return { message_id: 44 }; }),
      editMessageText: jest.fn(async (_chat: number, mid: number, text: string) => { edits.push(`edit:${mid}:${text}`); }),
    }), 9, { minIntervalMs: 0 });
    typist.push("مرحبا");
    await typist.flush();
    typist.push("مرحبا بالعالم");
    await typist.flush();
    const done = await typist.finish();
    expect(done).toEqual({ mode: "edit", msgId: 44, text: "مرحبا بالعالم" });
    expect(edits).toEqual(["send:مرحبا", "edit:44:مرحبا بالعالم"]);
  });
});

describe("finalizeShamEdit", () => {
  it("edits the first 4096 characters and sends the rest", async () => {
    const first = "أ".repeat(4096);
    const rest = "ب".repeat(20);
    const edits: string[] = [];
    const sends: string[] = [];
    await finalizeShamEdit(botWith({
      editMessageText: jest.fn(async (_c: number, _id: number, text: string) => { edits.push(text); }),
      sendMessage: jest.fn(async (_chat: number, text: string) => { sends.push(text); }),
    }), 3, 7, first + rest);
    expect(edits).toEqual([first]);
    expect(sends).toEqual([rest]);
  });
});
