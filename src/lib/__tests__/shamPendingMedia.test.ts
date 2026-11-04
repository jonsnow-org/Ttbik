import { clearPendingMediaIntent, loadPendingMediaIntent, savePendingMediaIntent } from "@/lib/shamThreads";
import { chatKey } from "@/lib/shamMemory";

type Stored = { intent: any; createdAt: number };
const store = new Map<string, Stored>();
const key = (chat: number | string, variant: string) => chatKey(chat) + "|" + variant;
const db: any = {
  ddl: true,
  exec: jest.fn(async (sql: string, ...args: any[]) => {
    if (sql.includes("INSERT INTO sham_media_pending")) {
      store.set(key(args[0], args[1]), { intent: JSON.parse(String(args[2])), createdAt: Date.now() });
    } else if (sql.includes("DELETE FROM sham_media_pending")) {
      store.delete(key(args[0], args[1]));
    }
  }),
  query: jest.fn(async (sql: string, ...args: any[]) => {
    if (!sql.includes("SELECT intent FROM sham_media_pending")) return [];
    const row = store.get(key(args[0], args[1]));
    if (!row || Date.now() - row.createdAt > 15 * 60_000) return [];
    return [{ intent: row.intent }];
  }),
};

describe("Sham pending media task state", () => {
  beforeEach(() => {
    store.clear();
    jest.useRealTimers();
  });

  it("survives independently of optional chat memory", async () => {
    await savePendingMediaIntent(77, "v2", { kind: "image", source: "اعطني صورة" }, db);
    await expect(loadPendingMediaIntent(77, "v2", db)).resolves.toEqual({ kind: "image", source: "اعطني صورة" });
  });

  it("isolates users and Sham v1/v2", async () => {
    await savePendingMediaIntent(77, "v2", { kind: "image", source: "اعطني صورة" }, db);
    await savePendingMediaIntent(77, "v1", { kind: "video", source: "اعطني فيديو", seconds: 30 }, db);
    await savePendingMediaIntent(88, "v2", { kind: "image", source: "اصنع صورة" }, db);
    await expect(loadPendingMediaIntent(77, "v2", db)).resolves.toMatchObject({ kind: "image", source: "اعطني صورة" });
    await expect(loadPendingMediaIntent(77, "v1", db)).resolves.toMatchObject({ kind: "video", seconds: 30 });
    await expect(loadPendingMediaIntent(88, "v2", db)).resolves.toMatchObject({ source: "اصنع صورة" });
    await expect(loadPendingMediaIntent(88, "v1", db)).resolves.toBeNull();
  });

  it("preserves the selected video duration and clamps it to the media limit", async () => {
    await savePendingMediaIntent(77, "v2", { kind: "video", source: "اعطني فيديو", seconds: 500 }, db);
    await expect(loadPendingMediaIntent(77, "v2", db)).resolves.toMatchObject({ kind: "video", seconds: 120 });
  });

  it("expires after fifteen minutes and can be explicitly cleared", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-11-05T10:00:00.000Z"));
    await savePendingMediaIntent(77, "v2", { kind: "image", source: "اعطني صورة" }, db);
    jest.advanceTimersByTime(15 * 60_000 + 1);
    await expect(loadPendingMediaIntent(77, "v2", db)).resolves.toBeNull();
    jest.useRealTimers();
    await savePendingMediaIntent(77, "v2", { kind: "image", source: "اعطني صورة" }, db);
    await clearPendingMediaIntent(77, "v2", db);
    await expect(loadPendingMediaIntent(77, "v2", db)).resolves.toBeNull();
  });
});
