import fs from "fs";
import path from "path";
const created: any[] = [];
jest.mock("@/lib/prisma", () => ({ prisma: { siteBannerAd: { create: jest.fn(async ({ data }: any) => { created.push(data); return data; }) } } }));
jest.mock("next/server", () => ({ NextRequest: class {}, NextResponse: { json: (body: any, init?: any) => ({ body, status: init?.status || 200 }) } }));
import { OWN_SPONSOR_SLOT, SPONSOR_TOOLS, SPONSOR_TOOL_IDS } from "@/lib/sponsorTools";
import { POST } from "@/app/api/ads/create/route";

describe("sponsored tool slots", () => {
  it("every sponsorable tool is a real page, with the two most-used tools first", () => {
    expect(SPONSOR_TOOLS.slice(0, 2).map((t) => t.id)).toEqual(["qr-generator", "zakat-calculator"]);
    for (const t of SPONSOR_TOOLS) {
      const dir = t.id === "guess-word" ? "src/app/guess-word" : `src/app/free-tools/${t.id}`;
      expect(fs.existsSync(path.join(__dirname, "../../..", dir, "page.tsx"))).toBe(true);
    }
    for (const id of OWN_SPONSOR_SLOT) expect(SPONSOR_TOOL_IDS.has(id)).toBe(true);
  });
  it("a zakat sponsorship can be ordered at the posted 7-day price", async () => {
    const r: any = await POST({ json: async () => ({ kind: "sponsor", placement: "zakat-calculator", altText: "متجر", bannerUrl: "عروض رمضان", targetUrl: "https://shop.example", days: 7 }) } as any);
    expect(r.status).toBe(200);
    expect(created[0]).toMatchObject({ kind: "sponsor", placement: "zakat-calculator", totalPrice: 15, durationDays: 7, paymentStatus: "PENDING" });
  });
  it("an unknown tool cannot be sponsored", async () => {
    const r: any = await POST({ json: async () => ({ kind: "sponsor", placement: "nope", altText: "x", bannerUrl: "y", targetUrl: "https://a.example", days: 7 }) } as any);
    expect(r.status).toBe(400);
  });
});
