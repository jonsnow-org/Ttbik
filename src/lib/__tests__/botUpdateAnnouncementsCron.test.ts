/** @jest-environment node */
// The announcements cron must never broadcast a backlog: old rows are closed without sending, and one run sends at most a few.
import { NextRequest } from "next/server";

const rows: any[] = [];
const updates: any[] = [];
jest.mock("@/lib/prisma", () => ({
  prisma: {
    botUpdateAnnouncement: {
      findMany: async () => rows.filter((r) => r.sentAt === null),
      update: async ({ where, data }: any) => { updates.push({ id: where.id, ...data }); const r = rows.find((x) => x.id === where.id); if (r) Object.assign(r, data); return r; },
    },
    bot: { findFirst: async () => null, findMany: async () => [] },
    novaUser: { findMany: async () => [] },
    botVisit: { findMany: async () => [] },
  },
}));

import { GET, ANNOUNCEMENT_MAX_AGE_MS, MAX_BROADCASTS_PER_RUN } from "@/app/api/cron/bot-update-announcements/route";

const call = () => GET(new NextRequest("https://site.test/api/cron/bot-update-announcements", { headers: { authorization: "Bearer s3cret" } }));
const ago = (ms: number) => new Date(Date.now() - ms);

describe("bot-update-announcements cron", () => {
  beforeEach(() => { process.env.CRON_SECRET = "s3cret"; rows.length = 0; updates.length = 0; });

  test("rejects a call without the cron secret", async () => {
    const res = await GET(new NextRequest("https://site.test/api/cron/bot-update-announcements"));
    expect(res.status).toBe(401);
  });

  test("closes stale announcements without sending and sends the fresh one", async () => {
    rows.push(
      { id: "old1", template: "JOBS_BOT", text: "old", createdAt: ago(ANNOUNCEMENT_MAX_AGE_MS + 3600_000), sentAt: null },
      { id: "old2", template: "AD_BOT", text: "older", createdAt: ago(30 * 24 * 3600_000), sentAt: null },
      { id: "new1", template: "JOBS_BOT", text: "fresh", createdAt: ago(3600_000), sentAt: null },
    );
    const body = await (await call()).json();
    expect(body.skippedStale).toBe(2);
    expect(body.results.map((r: any) => r.id)).toEqual(["new1"]);
    expect(updates.filter((u) => u.sentCount === 0).map((u) => u.id).sort()).toEqual(["new1", "old1", "old2"]);
    expect(rows.every((r) => r.sentAt !== null)).toBe(true);
  });

  test("one run broadcasts at most MAX_BROADCASTS_PER_RUN, oldest first; the rest wait", async () => {
    for (let i = 0; i < MAX_BROADCASTS_PER_RUN + 2; i++) rows.push({ id: `n${i}`, template: "JOBS_BOT", text: "t", createdAt: ago(3600_000 - i * 1000), sentAt: null });
    const body = await (await call()).json();
    expect(body.results).toHaveLength(MAX_BROADCASTS_PER_RUN);
    expect(rows.filter((r) => r.sentAt === null)).toHaveLength(2);
  });
});
