import { detectMediaIntent, isMusicGenerationRequest } from "@/lib/coderMediaFast";

describe("music generation is not mistaken for speech synthesis", () => {
  it.each([
    "اعطني صوت فتاة تغني",
    "أريد أغنية بصوت امرأة",
    "أنشئ أغنية قصيرة",
    "generate a song with a female singer",
    "make a girl singing voice",
  ])("recognizes unsupported song requests early: %s", (prompt) => {
    expect(isMusicGenerationRequest(prompt)).toBe(true);
  });

  it.each([
    "حوّل هذا النص إلى صوت: مرحباً بكم",
    "اقرأ هذه الجملة بصوت: أهلاً",
    "ما أشهر أغاني فيروز؟",
    "كيف أضيف الموسيقى إلى الفيديو؟",
    "مرحبا",
  ])("does not block ordinary speech or music discussion: %s", (prompt) => {
    expect(isMusicGenerationRequest(prompt)).toBe(false);
  });
});


describe("Arabic subject-only media follow-ups", () => {
  it("turns a short Arabic image description into a media request only after Sham asked for the missing image description", () => {
    expect(detectMediaIntent("حصان أبيض", {
      previousUser: "قم بتوليد صورة",
      previousAssistant: "ما الذي تريد أن يظهر في الصورة؟",
    })).toEqual({ kind: "image", subject: "حصان أبيض" });
  });

  it("resumes a previous image request after the former failed-description reply", () => {
    expect(detectMediaIntent("حصان أبيض", {
      previousUser: "قم بتوليد صورة",
      previousAssistant: "تعذّر فهم وصف الصورة بما يكفي لإنشائها. اكتب الوصف بجملة أوضح.",
    })).toEqual({ kind: "image", subject: "حصان أبيض" });
  });

  it("does not interpret a bare subject as an image request without a pending media clarification", () => {
    expect(detectMediaIntent("حصان أبيض")).toBeNull();
  });

  it("keeps ordinary follow-up subjects on the prior video request", () => {
    expect(detectMediaIntent("حصان أبيض", {
      previousUser: "قم بتوليد فيديو",
      previousAssistant: "ما المشهد الذي تريد أن يظهر في الفيديو؟",
    })).toEqual({ kind: "video", subject: "حصان أبيض" });
  });
});

describe("Media intent without an excluded-word dictionary", () => {
  it.each([
    ["قم بتوليد صورة لكود Python على شاشة", "لكود Python على شاشة"],
    ["أنشئ صورة لموقع شركة وتطبيق الهاتف", "لموقع شركة وتطبيق الهاتف"],
    ["اصنع صورة لمستودع GitHub وملف PDF", "لمستودع GitHub وملف PDF"],
    ["أنشئ صورة تشرح تحويل SVG إلى PNG", "تشرح تحويل SVG إلى PNG"],
  ])("accepts the user's natural subject words in '%s'", (prompt, subject) => {
    expect(detectMediaIntent(prompt)).toEqual({ kind: "image", subject });
  });

  it("accepts the same formerly excluded terms in a short subject-only follow-up", () => {
    expect(detectMediaIntent("كود Python داخل موقع", {
      previousUser: "قم بتوليد صورة",
      previousAssistant: "ما الذي تريد أن يظهر في الصورة؟",
    })).toEqual({ kind: "image", subject: "كود Python داخل موقع" });
  });

  it("does not delete request words that used to be in the filler dictionary", () => {
    expect(detectMediaIntent("قم بتوليد صورة من فضلك قطة جميلة")).toEqual({ kind: "image", subject: "من فضلك قطة جميلة" });
  });

  it("keeps ordinary non-media messages in the normal chat path", () => {
    expect(detectMediaIntent("اكتب كود بايثون")).toBeNull();
    expect(detectMediaIntent("اشرح كيف يعمل الموقع")).toBeNull();
    expect(detectMediaIntent("مرحبا")).toBeNull();
  });
});

describe("Nova video duration intent", () => {
  it.each([
    ["قم بتوليد فيديو أسد لمدة 10 ثواني", 10],
    ["أنشئ فديو أرنب 15 ثانية", 15],
    ["generate a video of a horse for 30 seconds", 30],
    ["make a video of a lighthouse for 1 minute", 60],
    ["قم بإنشاء فيديو قطة لمدة دقيقتين", 120],
    ["create a video of a fox for 2 min", 120],
  ])("extracts the requested duration from %s", (prompt, seconds) => {
    expect(detectMediaIntent(prompt)).toMatchObject({ kind: "video", seconds });
  });

  it("does not add duration words or numbers to the visual subject", () => {
    expect(detectMediaIntent("قم بتوليد فيديو أسد لمدة 30 ثانية")).toMatchObject({ kind: "video", subject: "أسد", seconds: 30 });
    expect(detectMediaIntent("أنشئ فيديو حصان لمدة 15 ثانيه")).toMatchObject({ kind: "video", subject: "حصان", seconds: 15 });
  });
});

describe("frame tag from the translator", () => {
  it("splits [wide] / [tall] / [square] from the prompt and leaves untagged text alone", async () => {
    const { splitAspect } = await import("@/lib/coderMediaFast");
    expect(splitAspect("[wide] a girl and a man walking among flowers")).toEqual({ prompt: "a girl and a man walking among flowers", aspect: "wide" });
    expect(splitAspect("[Tall] a woman on a beach")).toEqual({ prompt: "a woman on a beach", aspect: "tall" });
    expect(splitAspect("white horse")).toEqual({ prompt: "white horse" });
    expect(splitAspect("[wide]").prompt).toBeNull();
    expect(splitAspect(null).prompt).toBeNull();
  });
  it("maps the frame to a resolution every image Studio offers", async () => {
    const { frameFor } = await import("@/lib/photoWeightMedia");
    expect(frameFor("512 × 512", "wide")).toBe("768 × 512");
    expect(frameFor("512 × 768", "square")).toBe("512 × 512");
    expect(frameFor("512 × 512", "tall")).toBe("512 × 768");
    expect(frameFor("512 × 768 (author recommended)", "tall")).toBe("512 × 768 (author recommended)");
    expect(frameFor("512 × 768")).toBe("512 × 768");
  });
});

describe("model router line parsing (owner 2026-11-04)", () => {
  const mf = require("@/lib/coderMediaFast");
  it("parses CHAT / NO / IMAGE / VIDEO / AUDIO", () => {
    expect(mf.parseMediaRoute("CHAT")).toEqual({ kind: "chat" });
    expect(mf.parseMediaRoute("NO")).toBeNull(); // no refusal kind (owner 2026-11-04)
    expect(mf.sexualMinorRequest("صورة طفلة عارية")).toBe(true);
    expect(mf.sexualMinorRequest("a nude woman on a beach")).toBe(false);
    expect(mf.sexualMinorRequest("a small boy playing with a ball")).toBe(false);
    expect(mf.parseMediaRoute("IMAGE [tall] a chubby blonde girl wearing a swimsuit")).toEqual({ kind: "image", prompt: "a chubby blonde girl wearing a swimsuit", aspect: "tall" });
    expect(mf.parseMediaRoute("VIDEO 30 [wide] a lion running in the desert")).toEqual({ kind: "video", prompt: "a lion running in the desert", seconds: 30, aspect: "wide" });
    expect(mf.parseMediaRoute("VIDEO a rabbit playing in a garden")).toEqual({ kind: "video", prompt: "a rabbit playing in a garden", seconds: 10 });
    expect(mf.parseMediaRoute("VIDEO 45 a cat")?.seconds).toBe(30);
    expect(mf.parseMediaRoute("AUDIO مرحبا بكم في شام")).toEqual({ kind: "audio", prompt: "مرحبا بكم في شام" });
    expect(mf.parseMediaRoute("<think>x</think>\nIMAGE a red car")).toEqual({ kind: "image", prompt: "a red car" });
    expect(mf.parseMediaRoute("Sure! here it is")).toBeNull();
    expect(mf.parseMediaRoute("IMAGE حصان أبيض")).toBeNull();                 // an untranslated prompt is not accepted
  });
  it("asks the model only when the message might be about media", () => {
    expect(mf.mediaRouteNeeded("قم بتوليد صورة فتاة")).toBe(true);
    expect(mf.mediaRouteNeeded("فتاة شقراء ممتلئة ترتدي ملابس سباحة", { previousUser: "قم بتوليد صورة فتاة", previousAssistant: "🖼️ أُرسلت الصورة." })).toBe(true);
    expect(mf.mediaRouteNeeded("فتاة شقراء ممتلئة ترتدي ملابس سباحة")).toBe(false);
    expect(mf.mediaRouteNeeded("اكتب دالة بايثون لفرز قائمة")).toBe(false);
    expect(mf.mediaRouteNeeded("مرحبا")).toBe(false);
    expect(mf.mediaRouteNeeded("/start")).toBe(false);
  });
  it("detects a final answer that claims a file was sent", () => {
    expect(mf.claimsMediaSent("أرسلت الصورة")).toBe(true);
    expect(mf.claimsMediaSent("تم إرسال الفيديو إليك")).toBe(true);
    expect(mf.claimsMediaSent("I've sent the image above")).toBe(true);
    expect(mf.claimsMediaSent("هذه خطوات تثبيت المكتبة")).toBe(false);
  });
});
