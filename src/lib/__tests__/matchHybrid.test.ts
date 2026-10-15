import {
  buildInlineArticle, deepLink, matchesFilter, paginate, parseInlineQuery, parseProfileStart, publicCardText,
  rateLimit, scrubContacts, signInitData, toPublicProfile, validatePrefInput, validateProfileInput, verifyInitData,
} from "@/lib/match/inline";

const TOKEN = "123456:TEST-token";
const now = 1_760_000_000;
const user = JSON.stringify({ id: 777, first_name: "A" });

describe("initData verification", () => {
  const good = signInitData({ auth_date: String(now - 60), query_id: "q", user }, TOKEN);
  it("accepts valid", () => expect(verifyInitData(good, TOKEN, now)?.id).toBe("777"));
  it("rejects wrong token", () => expect(verifyInitData(good, "999:other", now)).toBeNull());
  it("rejects tampered field", () => expect(verifyInitData(good.replace("query_id=q", "query_id=x"), TOKEN, now)).toBeNull());
  it("rejects stale auth_date", () => expect(verifyInitData(good, TOKEN, now + 2 * 86400)).toBeNull());
  it("rejects future auth_date", () => expect(verifyInitData(signInitData({ auth_date: String(now + 3600), user }, TOKEN), TOKEN, now)).toBeNull());
  it("rejects missing/garbage hash", () => {
    expect(verifyInitData("auth_date=1&user=%7B%7D", TOKEN, now)).toBeNull();
    expect(verifyInitData(good.replace(/hash=[0-9a-f]+/, "hash=zz"), TOKEN, now)).toBeNull();
    expect(verifyInitData("", TOKEN, now)).toBeNull();
  });
  it("rejects missing user", () => expect(verifyInitData(signInitData({ auth_date: String(now) }, TOKEN), TOKEN, now)).toBeNull());
});

describe("query parsing", () => {
  it("arabic country + range + gender + keyword", () => {
    expect(parseInlineQuery("مصر 25-30 أنثى طبيبة")).toEqual({ country: "مصر", ageMin: 25, ageMax: 30, gender: "FEMALE", keywords: ["طبيبة"] });
  });
  it("english + arabic digits", () => {
    const f = parseInlineQuery("saudi ٢٨ male");
    expect(f).toMatchObject({ country: "السعودية", ageMin: 26, ageMax: 30, gender: "MALE" });
  });
  it("clamps to 18+", () => expect(parseInlineQuery("10-15").ageMin).toBe(18));
  it("age plus", () => expect(parseInlineQuery("30+").ageMin).toBe(30));
  it("empty", () => expect(parseInlineQuery("")).toEqual({ keywords: [] }));
});

const src = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e", userId: "111", gender: "FEMALE", age: 27, country: "مصر",
  city: "القاهرة", job: "مهندسة واتساب 0100 123 4567", education: "جامعي @myhandle", maritalStatus: "عزباء", verificationStatus: "VERIFIED",
  name: "سارة", contactValue: "@secret_user", attributes: "رقمي 0555", photoFileId: "AgAD",
};

describe("privacy filtering", () => {
  const p = toPublicProfile(src as any);
  const blob = JSON.stringify(p) + publicCardText(p);
  it("never leaks name/contact/userId/attributes/photo", () => {
    for (const bad of ["سارة", "secret_user", "myhandle", "0100", "4567", "0555", "AgAD", '"111"']) expect(blob).not.toContain(bad);
    expect(p).not.toHaveProperty("userId");
    expect(p).not.toHaveProperty("name");
  });
  it("scrubs links, emails, phones", () => {
    expect(scrubContacts("t.me/abc a@b.co +971 50 123 4567 ok")).not.toMatch(/abc|a@b|4567/);
  });
  it("filter matching", () => {
    expect(matchesFilter(src as any, { gender: "FEMALE", ageMin: 25, ageMax: 30, country: "مصر", keywords: [] })).toBe(true);
    expect(matchesFilter(src as any, { gender: "MALE", keywords: [] })).toBe(false);
    expect(matchesFilter(src as any, { country: "السعودية", keywords: [] })).toBe(false);
    expect(matchesFilter({ ...src, age: 17 } as any, { keywords: [] })).toBe(false);
    expect(matchesFilter(src as any, { keywords: ["القاهرة"] })).toBe(true);
  });
});

describe("inline results", () => {
  const a = buildInlineArticle(toPublicProfile(src as any), "Saragptbot", "https://ttbik.vercel.app/");
  it("shape", () => {
    expect(a.type).toBe("article");
    expect(a.title).toBe("ملف #0F8FAD5B - مصر/27");
    expect(a.id.length).toBeLessThanOrEqual(64);
    expect(a.thumbnail_url).toBe("https://ttbik.vercel.app/img/match-avatar-f.jpg");
    expect(a.reply_markup.inline_keyboard[0][0]).toEqual({ text: "اضغط للتواصل عبر البوت 🔒", url: `https://t.me/Saragptbot?start=profile_${src.id}` });
    expect(a.description).not.toMatch(/0100|myhandle/);
  });
  it("deep link round trip within 64 chars", () => {
    const payload = deepLink("@Saragptbot", src.id).split("start=")[1];
    expect(payload.length).toBeLessThanOrEqual(64);
    expect(parseProfileStart(payload)).toBe(src.id);
    expect(parseProfileStart("ref_123")).toBeNull();
    expect(parseProfileStart("profile_x'; drop")).toBeNull();
  });
  it("pagination", () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    expect(paginate(items, "")).toMatchObject({ nextOffset: "20" });
    expect(paginate(items, "40")).toEqual({ page: [40, 41, 42, 43, 44], nextOffset: "" });
    expect(paginate(items, "junk").page[0]).toBe(0);
  });
});

describe("validation & rate limit", () => {
  it("profile 18+", () => {
    const base = { gender: "MALE", name: "علي", age: "17", country: "مصر", contactMethod: "TELEGRAM", contactValue: "@ali_1234" };
    expect(validateProfileInput(base).ok).toBe(false);
    expect(validateProfileInput({ ...base, age: "٢٥" }).ok).toBe(true);
    expect(validateProfileInput({ ...base, age: "25", contactValue: "x" }).ok).toBe(false);
  });
  it("pref swaps and clamps", () => {
    const r = validatePrefInput({ country: "مصر", ageMin: "40", ageMax: "10" });
    expect(r.ok && [r.value.ageMin, r.value.ageMax]).toEqual([18, 40]);
  });
  it("rate limit", () => {
    expect([1, 2, 3].map(() => rateLimit("t", 2, 1000, 5))).toEqual([true, true, false]);
    expect(rateLimit("t", 2, 1000, 2000)).toBe(true);
  });
});
