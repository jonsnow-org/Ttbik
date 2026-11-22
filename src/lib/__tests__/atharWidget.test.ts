import zlib from "zlib";
import { atharWidgetHtml, dayState, handleAtharWidgetQuery, stepDay } from "@/lib/atharWidget";

jest.mock("@/lib/atharDay", () => {
  const actual = jest.requireActual("@/lib/atharDay");
  return {
    ...actual,
    atharDay: jest.fn(async (x: { y: number; m: number; d: number }) => ({
      index: 1, link: `https://athar.example/date?i=${x.d}&lang=ar`, img: "", known: true, anyFree: true, label: `${x.d} نوفمبر ${x.y}`,
      kinds: [{ name: "عادي", free: false }, { name: "فضي", free: true }, { name: "ذهبي", free: null }],
    })),
  };
});

describe("Athar day-card widget (read-only)", () => {
  it("fits Telegram's widget limits: html ≤ 32768 B and ≤ 4096 B compressed, no NUL", () => {
    const html = atharWidgetHtml();
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(32768);
    expect(zlib.deflateSync(html, { level: 9 }).length).toBeLessThanOrEqual(4096);
    expect(html).not.toContain("\u0000");
  });
  it("uses no network, no payment and no wallet call inside the widget", () => {
    const html = atharWidgetHtml();
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|sendTransaction|signData|wallet/);
    expect(html).toContain("W.openLink(u)");
  });
  it("steps one day either way inside 1950–2049 and stays put at the edges", () => {
    expect(stepDay({ y: 2026, m: 11, d: 22 }, 1)).toEqual({ y: 2026, m: 11, d: 23 });
    expect(stepDay({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 });
    expect(stepDay({ y: 2026, m: 3, d: 1 }, -1)).toEqual({ y: 2026, m: 2, d: 28 });
    expect(stepDay({ y: 2049, m: 12, d: 31 }, 1)).toEqual({ y: 2049, m: 12, d: 31 });
    expect(stepDay({ y: 1950, m: 1, d: 1 }, -1)).toEqual({ y: 1950, m: 1, d: 1 });
  });
  it("keeps the bubble state under 1024 bytes and marks unknown kinds", () => {
    const s = dayState({ y: 2026, m: 11, d: 22 }, { label: "22 نوفمبر 2026", link: "https://athar.example/date?i=1&lang=ar", kinds: [{ name: "عادي", free: true }, { name: "فضي", free: false }, { name: "ذهبي", free: null }], anyFree: true });
    expect(Buffer.byteLength(s)).toBeLessThanOrEqual(1024);
    expect(JSON.parse(s).k).toEqual([1, 0, -1]);
    expect(JSON.parse(dayState({ y: 2026, m: 11, d: 22 }, null)).k).toEqual([-1, -1, -1]);
  });
  it("answers a ◀ ▶ tap with the new day and refreshes the bubble; a bad request is answered empty", async () => {
    const calls: { m: string; p: any }[] = [];
    const bot = { api: { raw: new Proxy({}, { get: (_t, m: string) => async (p: any) => { calls.push({ m, p }); return true; } }) } } as any;
    await handleAtharWidgetQuery(bot, { id: "q1", data: "n:2026-11-22:+1", chat: { id: 5 }, message_id: 9 });
    expect(calls.map((c) => c.m)).toEqual(["answerWidgetQuery", "editMessageWidgetData"]);
    expect(JSON.parse(calls[0].p.data).d).toBe("2026-11-23");
    expect(calls[1].p).toMatchObject({ chat_id: 5, message_id: 9 });
    calls.length = 0;
    await handleAtharWidgetQuery(bot, { id: "q2", data: "buy:everything" });
    expect(calls).toHaveLength(1);
    expect(calls[0].p.data).toBeUndefined();
  });
});
