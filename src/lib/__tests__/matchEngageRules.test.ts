// MARRIAGE_BOT owner-approved features (2026-11-11): completeness, digest pick, two-way fit, «غير مناسب» feedback.
import { profileCompleteness, completenessLine, pickDigest, DIGEST_SIZE, type DigestCandidate } from "@/lib/match/engageRules";
import { feedbackPenalty, isNotSuitableReason, notSuitableCallback, rankMatchmakerScored, twoWayFit, NOT_SUITABLE_REASONS, type CandidateInput } from "@/lib/match/trustRules";

const full = { photo: true, voice: true, city: "دمشق", job: "مهندس", education: "جامعي", maritalStatus: "أعزب", attributes: "ملتزم وهادئ، أحب القراءة والسفر وأبحث عن شريكة متفاهمة", hasPref: true, quizDone: true, verified: true };

describe("📊 profile completeness", () => {
  it("a full profile is 100% with no tips", () => {
    expect(profileCompleteness(full)).toEqual({ percent: 100, tips: [] });
    expect(completenessLine({ percent: 100, tips: [] })).toContain("100%");
  });
  it("missing items lower the percent and list the most useful tip first", () => {
    const c = profileCompleteness({ ...full, photo: false, city: "", hasPref: false });
    expect(c.percent).toBe(55);
    expect(c.tips[0]).toContain("صورة");
    expect(c.tips).toHaveLength(3);
    expect(completenessLine(c)).toMatch(/55% ▰{6}▱{4}/);
  });
  it("a too-short «about» does not count", () => {
    expect(profileCompleteness({ ...full, attributes: "مرحبا" }).percent).toBe(85);
  });
});

describe("🔔 digest pick", () => {
  const c = (o: Partial<DigestCandidate>): DigestCandidate => ({ userId: "x", compat: 50, twoWay: false, likedMe: false, likedByMe: false, sentBefore: false, activeDays: 30, ...o });
  it("never repeats a profile from an earlier digest nor one already liked", () => {
    const ids = pickDigest([c({ userId: "sent", sentBefore: true, compat: 100 }), c({ userId: "liked", likedByMe: true, compat: 100 }), c({ userId: "ok" })]);
    expect(ids).toEqual(["ok"]);
  });
  it("takes at most 3, ranked by two-way fit, compatibility, a like from them, and activity", () => {
    const ids = pickDigest([
      c({ userId: "low", compat: 20 }), c({ userId: "two", twoWay: true, compat: 60 }), c({ userId: "fan", likedMe: true, compat: 70 }),
      c({ userId: "act", compat: 70, activeDays: 1 }), c({ userId: "mid", compat: 50 }),
    ]);
    expect(ids).toHaveLength(DIGEST_SIZE);
    expect(ids[0]).toBe("two");
    expect(ids).not.toContain("low");
  });
});

describe("🤝 two-way fit", () => {
  const me = { age: 30, country: "سوريا" };
  const her = { age: 27, country: "سوريا" };
  it("only when BOTH meet each other's stated wishes", () => {
    expect(twoWayFit(me, { country: "سوريا", ageMin: 24, ageMax: 30 }, her, { country: "سوريا", ageMin: 28, ageMax: 35 })).toBe(true);
    expect(twoWayFit(me, { country: "سوريا", ageMin: 24, ageMax: 30 }, her, { country: "مصر" })).toBe(false);
    expect(twoWayFit(me, null, her, { country: "سوريا" })).toBe(false); // unknown is not a badge
  });
});

describe("🙅 not suitable + reason", () => {
  it("callbacks fit Telegram's 64-byte limit and reasons are a closed list", () => {
    const pid = "00000000-0000-4000-8000-000000000001";
    for (const r of Object.keys(NOT_SUITABLE_REASONS)) {
      expect(isNotSuitableReason(r)).toBe(true);
      expect(Buffer.byteLength(notSuitableCallback("123456789", pid, r as any))).toBeLessThanOrEqual(64);
    }
    expect(isNotSuitableReason("toString")).toBe(false);
    expect(isNotSuitableReason("x")).toBe(false);
  });
  const cand = (o: Partial<CandidateInput>): CandidateInput => ({ id: o.userId || "c", userId: "c", gender: "FEMALE", age: 28, country: "سوريا", lastActiveAt: new Date(), ...o });
  it("a rejected look-alike is penalised (capped) and ranks below an otherwise equal candidate", () => {
    const rej = [{ reason: "age" as const, age: 40, country: "سوريا" }, { reason: "place" as const, age: 30, country: "سوريا", city: "حلب" }];
    expect(feedbackPenalty(cand({ age: 41, city: "حلب" }), rej)).toBeGreaterThan(0);
    expect(feedbackPenalty(cand({ age: 25, country: "مصر" }), rej)).toBe(0);
    expect(feedbackPenalty(cand({ age: 40, city: "حلب" }), Array(10).fill(rej).flat())).toBeLessThanOrEqual(30);
    const ranked = rankMatchmakerScored({ userId: "me", gender: "MALE", age: 35, country: "سوريا", rejections: rej }, [cand({ userId: "a", id: "a", age: 40 }), cand({ userId: "b", id: "b", age: 33 })]);
    expect(ranked[0].c.userId).toBe("b");
  });
});
