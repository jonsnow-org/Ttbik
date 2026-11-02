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
    expect(detectMediaIntent("قم بتوليد فيديو أسد لمدة 30 ثانية")).toMatchObject({ kind: "video", subject: "اسد", seconds: 30 });
    expect(detectMediaIntent("أنشئ فيديو حصان لمدة 15 ثانيه")).toMatchObject({ kind: "video", subject: "حصان", seconds: 15 });
  });
});
