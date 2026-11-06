import { mergeTaskEvents, lastEventId, splitSseFrames, sseFrameData, type LiveEvent, type TaskLike } from "@/lib/liveEvents";

const run = (id: string, events: LiveEvent[]) => ({ run_id: id, events });

describe("live SSE task events", () => {
  it("appends only new events to the matching task and leaves other tasks untouched", () => {
    const tasks = [run("a", [{ id: 1, kind: "start", text: "hi" }]), run("b", [{ id: 5, kind: "start", text: "other" }])];
    const next = mergeTaskEvents(tasks, "a", [{ id: 2, kind: "text", text: "wor" }, { id: 3, kind: "text", text: "ld" }]);
    expect(next).not.toBe(tasks);
    expect(next[0].events.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(next[1]).toBe(tasks[1]);
  });

  it("ignores already-shown ids and returns the same array so React can skip the render", () => {
    const tasks = [run("a", [{ id: 1, kind: "text", text: "x" }])];
    expect(mergeTaskEvents(tasks, "a", [{ id: 1, kind: "text", text: "x" }])).toBe(tasks);
    expect(mergeTaskEvents(tasks, "a", [])).toBe(tasks);
    expect(mergeTaskEvents(tasks, "missing", [{ id: 2, kind: "text", text: "y" }])).toBe(tasks);
  });

  it("sorts out-of-order replayed events by id", () => {
    const tasks = [run("a", [{ id: 3, kind: "text", text: "c" }])];
    const next = mergeTaskEvents(tasks, "a", [{ id: 4, kind: "text", text: "d" }, { id: 2, kind: "text", text: "b" }]);
    expect(next[0].events.map((e) => e.id)).toEqual([2, 3, 4]);
  });

  it("reports the highest id as the reconnect cursor", () => {
    const tasks: TaskLike[] = [run("a", [{ id: 7, kind: "text", text: "x" }, { id: 11, kind: "text", text: "y" }])];
    expect(lastEventId(tasks, "a")).toBe(11);
    expect(lastEventId(tasks, "none")).toBe(0);
  });

  it("splits an SSE buffer into whole frames and keeps the partial tail", () => {
    const { frames, rest } = splitSseFrames("id: 1\ndata: {\"id\":1}\n\nid: 2\ndata: {\"id\":");
    expect(frames).toEqual(["id: 1\ndata: {\"id\":1}"]);
    expect(rest).toBe("id: 2\ndata: {\"id\":");
  });

  it("parses a data frame and rejects comments and malformed payloads", () => {
    expect(sseFrameData("event: task\ndata: {\"id\":9,\"kind\":\"text\",\"text\":\"hi\"}")).toMatchObject({ id: 9, text: "hi" });
    expect(sseFrameData(": keep-alive")).toBeNull();
    expect(sseFrameData("data: not json")).toBeNull();
    expect(sseFrameData("data: {\"kind\":\"text\"}")).toBeNull();
  });
});
