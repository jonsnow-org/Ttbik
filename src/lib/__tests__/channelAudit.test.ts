import {
  auditChannel, canMove, gradeReach, makeDealCode, normalizeChannel, parseChannelPage, parseCount, parsePostLink, postMatchesDeal, splitDeal, validDealPrice,
} from "@/lib/channels/auditRules";

const post = (id: number, views: string, at: string, text = "منشور") => `
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="testch/${id}">
<div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div>
<span class="tgme_widget_message_views">${views}</span><time datetime="${at}" class="time">12:00</time></div></div>`;

const page = (subs: string, posts: string) => `<html><div class="tgme_channel_info"><div class="tgme_channel_info_header_title"><span dir="auto">قناة &amp; تجربة</span></div>
<div class="tgme_channel_info_description">وصف القناة SHAM-ABC123</div>
<div class="tgme_channel_info_counters"><div class="tgme_channel_info_counter"><span class="counter_value">${subs}</span> <span class="counter_type">subscribers</span></div>
<div class="tgme_channel_info_counter"><span class="counter_value">120</span> <span class="counter_type">photos</span></div></div></div>${posts}</html>`;

describe("channel audit rules", () => {
  it("normalizes channel identifiers and rejects junk", () => {
    expect(normalizeChannel("@My_Channel")).toBe("My_Channel");
    expect(normalizeChannel("https://t.me/s/My_Channel/12")).toBe("My_Channel");
    expect(normalizeChannel("t.me/joinchat/abc")).toBeNull();
    expect(normalizeChannel("ab")).toBeNull();
    expect(normalizeChannel("bad name!")).toBeNull();
  });
  it("parses compact counts", () => {
    expect(parseCount("10.1M")).toBe(10_100_000);
    expect(parseCount("6.6K")).toBe(6600);
    expect(parseCount("1 234")).toBe(1234);
    expect(parseCount("")).toBeNull();
  });
  it("parses a public preview page and audits reach, dropping the newest post", () => {
    const html = page("10K", post(1, "2K", "2026-11-01T10:00:00+00:00") + post(2, "3K", "2026-11-03T10:00:00+00:00") + post(3, "2.5K", "2026-11-05T10:00:00+00:00") + post(4, "100", "2026-11-09T10:00:00+00:00"));
    const c = parseChannelPage("testch", html)!;
    expect(c.title).toBe("قناة & تجربة");
    expect(c.subscribers).toBe(10_000);
    expect(c.description).toContain("SHAM-ABC123");
    expect(c.posts.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    const r = auditChannel(c, new Date("2026-11-10T00:00:00Z"));
    expect(r.postsSampled).toBe(3);
    expect(r.medianViews).toBe(2500);
    expect(r.reachPct).toBe(25);
    expect(r.grade).toBe("excellent");
    expect(r.priceLow).toBe(38);
    expect(r.priceHigh).toBe(63);
    expect(r.notes).toHaveLength(0);
  });
  it("flags inflated channels and stale ones", () => {
    expect(gradeReach(1.2, 50_000)).toBe("suspicious");
    expect(gradeReach(1.2, 500)).toBe("weak");
    expect(gradeReach(12, 5000)).toBe("good");
    expect(gradeReach(null, null)).toBe("unknown");
    const c = parseChannelPage("testch", page("100K", post(1, "500", "2026-09-01T10:00:00Z") + post(2, "400", "2026-09-02T10:00:00Z")))!;
    const r = auditChannel(c, new Date("2026-11-10T00:00:00Z"));
    expect(r.grade).toBe("suspicious");
    expect(r.notes.join(" ")).toMatch(/أسبوعين/);
  });
  it("returns null for pages that are not public channels", () => {
    expect(parseChannelPage("x", "<html>user page</html>")).toBeNull();
  });
});

describe("channel deals", () => {
  it("splits 15% commission and bounds prices", () => {
    expect(splitDeal(40)).toEqual({ price: 40, commission: 6, payout: 34 });
    expect(splitDeal(7.5)).toEqual({ price: 7.5, commission: 1.13, payout: 6.37 });
    expect(validDealPrice(4)).toBe(false);
    expect(validDealPrice(5)).toBe(true);
    expect(validDealPrice(2001)).toBe(false);
    expect(validDealPrice("10")).toBe(false);
  });
  it("only allows escrow moves in order", () => {
    expect(canMove("PENDING_PAYMENT", "PAID")).toBe(true);
    expect(canMove("PENDING_PAYMENT", "RELEASED")).toBe(false);
    expect(canMove("PAID", "VERIFIED")).toBe(true);
    expect(canMove("VERIFIED", "RELEASED")).toBe(true);
    expect(canMove("RELEASED", "REFUNDED")).toBe(false);
    expect(canMove("REFUNDED", "PAID")).toBe(false);
  });
  it("accepts post links only from the deal's channel and matches the advertiser link or code", () => {
    expect(parsePostLink("https://t.me/testch/55", "TestCh")).toBe(55);
    expect(parsePostLink("https://t.me/s/testch/55?single", "testch")).toBe(55);
    expect(parsePostLink("https://t.me/other/55", "testch")).toBeNull();
    expect(postMatchesDeal("جرّب الآن https://shop.example.com/x", "https://shop.example.com/x", "CHD-AAAA2222")).toBe(true);
    expect(postMatchesDeal("إعلان chd-aaaa2222", "https://zz.io", "CHD-AAAA2222")).toBe(true);
    expect(postMatchesDeal("منشور آخر", "https://shop.example.com", "CHD-AAAA2222")).toBe(false);
  });
  it("makes readable deal codes", () => {
    const code = makeDealCode("CHD", new Uint8Array([0, 1, 2, 3, 4, 5, 6, 255]));
    expect(code).toMatch(/^CHD-[A-Z0-9]{8}$/);
  });
});
