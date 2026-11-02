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
    expect(detectMediaIntent("قم بتوليد فيديو أسد لمدة 30 ثانية")).toEqual({ kind: "video", subject: "اسد" });
  });
});
