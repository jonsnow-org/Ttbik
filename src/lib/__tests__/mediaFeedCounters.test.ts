import { FakeDb } from "./fakeDb";

let db: any;
let user: { id: string; name: string } | null = { id: "10", name: "زائر" };
jest.mock("@/lib/mediaSocial", () => ({
  ...jest.requireActual("@/lib/mediaSocial"),
  mediaDb: async () => db,
  mediaUser: () => user,
}));
jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: { json: (body: any, init?: any) => ({ body, status: init?.status || 200, json: async () => body }) },
}));

import { PATCH } from "@/app/api/media-feed/route";

const call = async (action: string) => ((await PATCH({ json: async () => ({ id: "p1", action, init_data: "signed" }) } as any)) as any).body;

beforeEach(() => {
  db = new FakeDb();
  db.tables.media_feed = [{ id: "p1", sharer_id: "99", sharer_name: "ناشر", views: 0, likes: 0, clones: 0 }];
  user = { id: "10", name: "زائر" };
  process.env.BOT_TOKEN = "123:TEST";
  (global as any).fetch = async () => ({ json: async () => ({ ok: true }) });
});

describe("views are stored", () => {
  it("counts the first view, writes the log row and the counter", async () => {
    const r = await call("view");
    expect(r.counted).toBe(true); expect(r.views).toBe(1);
    expect(db.tables.media_feed[0].views).toBe(1);
    expect(db.tables.media_views).toHaveLength(1);
  });
  it("opening the same post again straight away is one view", async () => {
    await call("view");
    const r = await call("view");
    expect(r.counted).toBe(false); expect(r.reason).toBe("cooldown");
    expect(db.tables.media_feed[0].views).toBe(1);
  });
  it("coming back after the cooldown counts again, and many people add up", async () => {
    await call("view");
    db.tables.media_views[0].last_at = new Date(Date.now() - 31 * 60_000).toISOString();
    expect((await call("view")).views).toBe(2);
    user = { id: "11", name: "آخر" };
    expect((await call("view")).views).toBe(3);
    expect(db.tables.media_feed[0].views).toBe(3);
  });
  it("the sharer's own view counts too (so the owner can see it work)", async () => {
    user = { id: "99", name: "ناشر" };
    expect((await call("view")).counted).toBe(true);
  });
  it("says why when nothing is counted, so the app can retry instead of giving up", async () => {
    user = null;
    expect((await call("view")).reason).toBe("no-auth");
    user = { id: "10", name: "زائر" };
    db.failTables.add("media_views");
    const r = await call("view");
    expect(r.counted).toBe(false); expect(r.reason).toBe("storage");
    expect(db.tables.media_feed[0].views).toBe(0);
  });
});

describe("likes", () => {
  it("count once, notify the sharer, and unlike takes it back", async () => {
    expect((await call("like")).likes).toBe(1);
    expect((await call("like")).reason).toBe("already");
    expect(db.tables.media_notifications).toHaveLength(1);
    expect(db.tables.media_notifications[0].to_id).toBe("99");
    expect((await call("unlike")).likes).toBe(0);
    expect((await call("unlike")).reason).toBe("not-liked");
  });
  it("a like that could not be stored is reported as such", async () => {
    db.failTables.add("media_likes");
    expect((await call("like")).reason).toBe("storage");
    expect(db.tables.media_feed[0].likes).toBe(0);
  });
});
