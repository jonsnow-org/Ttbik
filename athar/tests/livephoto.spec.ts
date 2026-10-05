// A token that carries a photo keeps maturing: the live portrait re-draws the frame, the badge and the age around the stored photo.
import { renderPhotoArt } from "../web/lib/art";
import { imgResponse, storedPhoto } from "../web/lib/handlers";
import { arweaveId } from "../web/lib/ids";

const REF = arweaveId(424242n), HIDDEN = arweaveId(171717n);
const uri = "data:image/jpeg;base64," + "QUJD".repeat(500);
const stored = (gold = false, tier = 0) => renderPhotoArt({ index: 19000, tier, season: 1, stage: 0, hands: 1, engravings: 0, gold }, uri, { w: 400, h: 500 });

beforeEach(() => {
  (global as any).fetch = jest.fn(async (url: string) => {
    if (url.includes(REF) || url.includes(HIDDEN)) return { ok: true, text: async () => stored(url.includes(HIDDEN)) };
    return { ok: false, text: async () => "" };
  });
});

const url = (extra = "") => `https://x/api/img/19000.svg?s=1&g=4&h=5&e=0&t=0&o=0&live=1&p=${REF}${extra}`;

describe("live portrait of a photo token", () => {
  it("keeps the photo and shows the age on the frame and on the badge", async () => {
    const r = await imgResponse("19000.svg", url(), { isHiddenRef: () => false });
    const svg = await r.text();
    expect(svg).toContain(uri);
    expect(svg).toContain("ar-st4");      // the frame's age marks
    expect(svg).toContain("ar-bst4");     // the badge's age marks
    expect(svg).toContain("ar-bd");
  });
  it("a picture on the takedown list is never composed", async () => {
    const svg = await (await imgResponse("19000.svg", url(), { isHiddenRef: (ref) => ref === REF })).text();
    expect(svg).not.toContain(uri);
  });
  it("the mirror (no takedown list) ignores the stored-picture parameter", async () => {
    const svg = await (await imgResponse("19000.svg", url())).text();
    expect(svg).not.toContain(uri);
  });
  it("reads the photo, its shape and whether its frame is gold", async () => {
    const a = await storedPhoto(REF);
    expect(a).toMatchObject({ uri, w: expect.any(Number), h: expect.any(Number), gold: false });
    const b = await storedPhoto(HIDDEN);
    expect(b!.gold).toBe(true);
  });
  it("garbage ids are ignored", async () => {
    const svg = await (await imgResponse("19000.svg", `https://x/api/img/19000.svg?live=1&p=nope`, { isHiddenRef: () => false })).text();
    expect(svg).not.toContain("data:image/jpeg");
  });
});
