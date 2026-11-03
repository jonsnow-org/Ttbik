import { detectMediaIntent } from "@/lib/coderMediaFast";

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

  it("routes past-tense Arabic image requests to the selected image Studio", () => {
    expect(detectMediaIntent("طلبت صورة فتاة على البحر")).toEqual({
      kind: "image",
      subject: "فتاة على البحر",
    });
    expect(detectMediaIntent("طلبت صورة لامرأة على الشاطئ")).toEqual({
      kind: "image",
      subject: "لامرأة على الشاطئ",
    });
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
