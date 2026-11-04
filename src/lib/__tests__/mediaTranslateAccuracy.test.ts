// Owner 2026-11-04: the media prompt is a FAITHFUL translation (nothing added, nothing removed); a video request is never answered with a photo;
// a false "here is the picture" sentence goes without taking the rest of the answer with it.
import { MEDIA_ROUTER_SYSTEM, MEDIA_TRANSLATE_SYSTEM, MEDIA_NOT_DONE, claimsMediaSent, dropMediaClaims, parseMediaRoute, reconcileRoute } from "@/lib/coderMediaFast";

describe("translation accuracy instructions", () => {
  test.each([["translator", MEDIA_TRANSLATE_SYSTEM], ["router", MEDIA_ROUTER_SYSTEM]])("%s: beauty words mean beautiful, nothing is added or dropped", (_n, text) => {
    expect(text).toMatch(/حسناء/);
    expect(text).toMatch(/beautiful/);
    expect(text).toMatch(/say(?:s)? nothing about clothing or the body/);
    expect(text).toMatch(/never add clothing, undressing, body or pose details the user did not write/i);
    expect(text).toMatch(/a beautiful blonde girl/);
  });
  test("the translator keeps every detail the user wrote", () => {
    expect(MEDIA_TRANSLATE_SYSTEM).toMatch(/never drop one they did write/);
    expect(MEDIA_TRANSLATE_SYSTEM).toMatch(/never add, remove, soften, replace or invent anything/);
  });
  test("the router knows the 6 s video and that a video word is never a picture", () => {
    expect(MEDIA_ROUTER_SYSTEM).toMatch(/\(6, 10, 15, 30, 60 or 120\)/);
    expect(MEDIA_ROUTER_SYSTEM).toMatch(/VIDEO 6 \[tall\] a girl dancing/);
  });
});

describe("a video request stays a video", () => {
  test("IMAGE from a small model for «فديو … 6 ثوان» becomes a 6 s video with the model's own prompt", () => {
    const routed = parseMediaRoute("IMAGE [tall] a girl dancing");
    expect(reconcileRoute(routed, "قم بتوليد فديو فتاة ترقص 6 ثوان")).toEqual({ kind: "video", prompt: "a girl dancing", seconds: 6, aspect: "tall" });
  });
  test("the user's duration wins over the router's", () => {
    expect(reconcileRoute(parseMediaRoute("VIDEO 10 [wide] a lion running"), "قم بتوليد فيديو أسد يركض 30 ثانية")).toMatchObject({ kind: "video", seconds: 30 });
  });
  test("a picture request is untouched; chat stays chat", () => {
    const img = parseMediaRoute("IMAGE [tall] a beautiful blonde girl");
    expect(reconcileRoute(img, "قم بتوليد صورة فتاة شقراء حسناء")).toBe(img);
    expect(reconcileRoute({ kind: "chat" }, "قم بتوليد فديو قطة")).toEqual({ kind: "chat" });
  });
});

describe("false 'sent' claims", () => {
  test("only the claim sentence goes; a greeting stays", () => {
    const out = dropMediaClaims("مرحباً! كيف أستطيع مساعدتك اليوم؟ ها هي الصورة التي طلبتها.", false);
    expect(out).toContain("مرحباً");
    expect(claimsMediaSent(out)).toBe(false);
  });
  test("nothing left: the media note only when the run tried to make media", () => {
    expect(dropMediaClaims("أرسلت الصورة.", true)).toBe(MEDIA_NOT_DONE);
    expect(dropMediaClaims("أرسلت الصورة.", false)).not.toBe(MEDIA_NOT_DONE);
  });
});
