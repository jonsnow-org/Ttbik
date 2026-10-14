import { crisisMessage, detectCrisis, LEGAL_DISCLAIMER, legalRequestIsHighRisk, mindReplyIsSafe, withLegalDisclaimer } from "@/lib/hub/safety";
import { badgesFor, canRedeemBashar, DAILY_CAP, levelFor, pointsToAward } from "@/lib/hub/points";
import { applyChatEdit, buildFromDescription, detectTemplate, makeSlug, MAX_ITEMS, validateAppConfig } from "@/lib/hub/appConfig";
import { draftLegalDoc, repurposeFallback } from "@/lib/hub/tools";

describe("crisis detection", () => {
  it.each([
    "بدي موت", "أبغى أموت", "عايز أموت خلاص", "بفكر في الانتحار", "رح أقتل حالي", "ما بدي عيش", "مش عايز اعيش", "بدي أأذي نفسي",
    "ودّي أموووت", "أنهي حياتي", "I want to die", "thinking about suicide", "ليتني مت",
  ])("detects %s", (t) => expect(detectCrisis(t)).toBe(true));
  it.each(["أنا متضايق من الشغل", "مات جدي الشهر الماضي وأنا حزين", "كيف أنام أفضل؟", "الجو حار يموّت"])("no false alarm: %s", (t) =>
    expect(detectCrisis(t)).toBe(false));
  it("crisis message is fixed text with country numbers", () => {
    const m = crisisMessage("SA");
    expect(m).toContain("911");
    expect(m).toContain("findahelpline.com");
    expect(crisisMessage(null)).toContain("findahelpline.com");
  });
  it("mental replies with medication or diagnosis are rejected", () => {
    expect(mindReplyIsSafe("خذ سيرترالين 50 ملغ")).toBe(false);
    expect(mindReplyIsSafe("أنت مصاب بالاكتئاب")).toBe(false);
    expect(mindReplyIsSafe("أسمعك، جرّب تمرين التنفس")).toBe(true);
  });
});

describe("legal guardrails", () => {
  it("adds the disclaimer once", () => {
    const a = withLegalDisclaimer("نص");
    expect(a).toContain(LEGAL_DISCLAIMER);
    expect(withLegalDisclaimer(a).split("ليست استشارة قانونية").length).toBe(2);
  });
  it("refuses high-risk requests", () => {
    expect(legalRequestIsHighRisk("كيف أزوّر عقد إيجار")).toBe(true);
    expect(legalRequestIsHighRisk("بدي اخفي الأدلة")).toBe(true);
    expect(legalRequestIsHighRisk("كيف أتهرب من الشرطة")).toBe(true);
    expect(legalRequestIsHighRisk("المالك لا يعيد التأمين")).toBe(false);
  });
  it("drafts carry the disclaimer and fill fields", () => {
    const d = draftLegalDoc("rental", { المؤجر: "أحمد" }, "SY")!;
    expect(d).toContain("أحمد");
    expect(d).toContain("[المستأجر]");
    expect(d).toContain("سوريا");
    expect(d).toContain("ليست استشارة قانونية");
    expect(draftLegalDoc("unknown", {}, "SY")).toBeNull();
  });
});

describe("points math", () => {
  it("respects the daily cap", () => {
    expect(pointsToAward("app_create", 0)).toBe(10);
    expect(pointsToAward("app_create", DAILY_CAP - 4)).toBe(4);
    expect(pointsToAward("tool_use", DAILY_CAP)).toBe(0);
    expect(pointsToAward("tool_use", 999)).toBe(0);
  });
  it("levels and progress", () => {
    expect(levelFor(0)).toMatchObject({ level: 1, next: 50, progress: 0 });
    expect(levelFor(100)).toMatchObject({ level: 2, progress: 50 });
    expect(levelFor(5000)).toMatchObject({ level: 5, next: null, progress: 100 });
    expect(levelFor(-5).level).toBe(1);
  });
  it("badges and redemption", () => {
    expect(badgesFor(0, { app_create: 1 })).toContain("🧱 أول تطبيق");
    expect(badgesFor(500, {})).toContain("⭐ خبير");
    expect(canRedeemBashar(9)).toBe(false);
    expect(canRedeemBashar(10)).toBe(true);
  });
});

describe("app config", () => {
  it("validates and strips unsafe content", () => {
    const v = validateAppConfig({ template: "store", title: "<b>ريحان</b>", color: "red", items: [{ title: "عود", price: "30$", url: "javascript:alert(1)" }] });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.config.title).toBe("bريحان/b");
      expect(v.config.color).toBe("#4f46e5");
      expect(v.config.items[0].url).toBeUndefined();
    }
  });
  it("rejects bad templates, empty titles and too many items", () => {
    expect(validateAppConfig({ template: "casino", title: "x1" }).ok).toBe(false);
    expect(validateAppConfig({ template: "store", title: "" }).ok).toBe(false);
    expect(validateAppConfig({ template: "store", title: "ab", items: Array(MAX_ITEMS + 1).fill({ title: "a" }) }).ok).toBe(false);
  });
  it("quiz items need options and a valid answer; links need https", () => {
    const q = validateAppConfig({ template: "quiz", title: "اختبار", items: [{ title: "س", options: ["أ", "ب"], answer: 1 }, { title: "س2", options: ["أ"], answer: 0 }] });
    expect(q.ok && q.config.items.length).toBe(1);
    const l = validateAppConfig({ template: "links", title: "روابطي", items: [{ title: "a", url: "http://x.com" }, { title: "b", url: "https://t.me/x" }] });
    expect(l.ok && l.config.items.length).toBe(1);
  });
  it("builds from natural language", () => {
    expect(detectTemplate("بدي منيو لمطعمي")).toBe("menu");
    expect(detectTemplate("صالون حلاقة مع حجز مواعيد")).toBe("booking");
    const c = buildFromDescription("متجر عطور اسمه ريحان باللون الذهبي");
    expect(c).toMatchObject({ template: "store", title: "ريحان", color: "#b8860b" });
    expect(makeSlug("Rayhan Store")).toMatch(/^rayhan-store-[a-f0-9]{8}$/);
    expect(makeSlug("ريحان")).toMatch(/^app-[a-f0-9]{8}$/);
  });
  it("chat edits apply instantly and unknown text changes nothing", () => {
    const c = buildFromDescription("متجر اسمه ريحان");
    const a = applyChatEdit(c, "أضف قهوة بسعر 3$");
    expect(a.changed).toBe("ok");
    expect(a.config.items.at(-1)).toMatchObject({ title: "قهوة", price: "3$" });
    expect(applyChatEdit(a.config, "احذف قهوة").config.items.length).toBe(c.items.length);
    expect(applyChatEdit(c, "اللون أخضر").config.color).toBe("#16a34a");
    expect(applyChatEdit(c, "غيّر الاسم إلى مسك").config.title).toBe("مسك");
    expect(applyChatEdit(c, "مرحبا").changed).toBeNull();
  });
});

describe("repurpose fallback", () => {
  it("makes a numbered thread without AI", () => {
    const t = repurposeFallback("هذه جملة أولى طويلة بما يكفي. وهذه جملة ثانية طويلة أيضاً! وهذه ثالثة طويلة جداً؟", "thread");
    expect(t).toMatch(/^1\//);
    expect(t).toContain("2/");
  });
});
