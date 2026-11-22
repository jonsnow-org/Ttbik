/** @jest-environment node */
// A third-party thumbnail that fails (expired Facebook/Instagram/TikTok signature) must answer 424, never 502/503/504:
// the site gate reads 502-504 from Oracle as "Oracle is down", retries and fails over to the standby (HTTP 402 while Vercel is paused).
import { NextRequest } from "next/server";

jest.mock("@/lib/mediaSocial", () => ({
  isPlaceholderTitle: () => false,
  isTikTok: () => false,
  tiktokOembed: async () => null,
  mediaDb: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "a1", url: "https://example.com/v", thumbnail: "https://scontent.xx.fbcdn.net/x.jpg", title: "t", hidden: false, squad_code: null } }) }) }) }),
  }),
}));
jest.mock("@/lib/mediaVisibility", () => ({ canAccessMediaPost: () => true }));

import { GET } from "@/app/api/media-thumb/route";

const req = () => new NextRequest("https://site.test/api/media-thumb?id=a1");

describe("media-thumb upstream failure status", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  test("an expired CDN link (403) answers 424 with a short cache, not 502", async () => {
    global.fetch = jest.fn(async () => new Response("denied", { status: 403, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const res = await GET(req());
    expect(res.status).toBe(424);
    expect(res.headers.get("cache-control")).toContain("s-maxage=600");
  });

  test("a network error answers 424", async () => {
    global.fetch = jest.fn(async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch;
    expect((await GET(req())).status).toBe(424);
  });

  test("a good image is passed through with 200", async () => {
    global.fetch = jest.fn(async () => new Response("img", { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });
});
