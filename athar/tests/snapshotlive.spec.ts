// The site draws an ordinary token live even when its permanent picture is a saved copy of the generated art (frozen, old motion).
jest.mock("../web/lib/chain", () => ({ ...jest.requireActual("../web/lib/chain") }));
import { imgResponse } from "../web/lib/handlers";
import { renderArt } from "../web/lib/art";

const REF = "a".repeat(43);
describe("saved copy of the generated art", () => {
  it("is not served back as it was stored: the live drawing wins", async () => {
    const stored = renderArt({ index: 19000, tier: 0, season: 1, stage: 0, hands: 1, engravings: 0 }).replace("</svg>", "<!--OLD-STORED--></svg>");
    const realFetch = global.fetch;
    global.fetch = (async () => new Response(stored, { headers: { "content-type": "image/svg+xml" } })) as any;
    try {
      const r = await imgResponse("19000.svg", `https://x.test/api/img/19000.svg?t=0&g=2&h=3&live=1&p=${REF}`, { isHiddenRef: () => false });
      const body = await r.text();
      expect(body).not.toContain("OLD-STORED");
      expect(body).toContain('class="ar-rb"');             // the new inner-circle motion
      expect(body).toContain("@keyframes ar-scat");
    } finally { global.fetch = realFetch; }
  });
});
