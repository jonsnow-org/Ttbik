import {
  CARD_BUTTON, MATCHMAKER_BUTTON, PRICE_MATCHMAKER, cardLink, cardStartPayload, checkMatchmakerNote, isCardInlineQuery, parseCardStart, shortfallStars,
} from "@/lib/match/trustRules";
import { containsContactInfo } from "@/lib/match/contactGuard";

const uuid = "3f2b8c1e-9a4d-4e2b-8c7a-1d2e3f4a5b6c";

describe("زواج بثقة: shareable card", () => {
  it("round-trips the c_<uuid> payload within Telegram's 64-char start limit", () => {
    const p = cardStartPayload(uuid);
    expect(p.length).toBeLessThanOrEqual(64);
    expect(/^[A-Za-z0-9_-]+$/.test(p)).toBe(true);
    expect(parseCardStart(p)).toBe(uuid);
    expect(parseCardStart(uuid.toUpperCase().replace(/^/, "c_"))).toBe(uuid);
  });
  it("rejects anything that is not a card payload", () => {
    expect(parseCardStart(`profile_${uuid}`)).toBeNull();
    expect(parseCardStart("c_123")).toBeNull();
    expect(parseCardStart(null)).toBeNull();
    expect(parseCardStart(`c_${uuid}x`)).toBeNull();
  });
  it("builds the bot link without a leading @", () => {
    expect(cardLink("@MyBot", uuid)).toBe(`https://t.me/MyBot?start=c_${uuid}`);
  });
  it("recognises the inline query for the member's own card", () => {
    expect(isCardInlineQuery(" بطاقتي ")).toBe(true);
    expect(isCardInlineQuery("ME")).toBe(true);
    expect(isCardInlineQuery("مصر 25")).toBe(false);
  });
  it("keeps the menu labels stable", () => {
    expect(CARD_BUTTON).toBe("🪪 بطاقتي للمشاركة");
    expect(MATCHMAKER_BUTTON).toContain(`$${PRICE_MATCHMAKER}`);
  });
});

describe("زواج بثقة: human matchmaker", () => {
  it("accepts a clear description", () => {
    const r = checkMatchmakerNote("  أبحث عن شريكة من الأردن بين 24 و30 سنة، ملتزمة  ", containsContactInfo);
    expect(r.ok).toBe(true);
  });
  it("refuses empty, too long, or contact details", () => {
    expect(checkMatchmakerNote("قصير", containsContactInfo)).toEqual({ ok: false, reason: "empty" });
    expect(checkMatchmakerNote("ا".repeat(501), containsContactInfo)).toEqual({ ok: false, reason: "long" });
    const contact = checkMatchmakerNote("تواصل معي على @someone_handle أو 0791234567", containsContactInfo);
    expect(contact.ok).toBe(false);
  });
  it("charges only the Stars shortfall (100 ⭐ = $1)", () => {
    expect(shortfallStars(5, 0)).toBe(500);
    expect(shortfallStars(5, 1.5)).toBe(350);
    expect(shortfallStars(5, 4.999)).toBe(1);
    expect(shortfallStars(5, -2)).toBe(500);
  });
});
