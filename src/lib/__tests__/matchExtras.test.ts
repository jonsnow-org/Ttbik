jest.mock("../prisma", () => ({ prisma: { $executeRawUnsafe: jest.fn().mockResolvedValue(1), $queryRawUnsafe: jest.fn().mockResolvedValue([]) } }));
jest.mock("../groq", () => ({ callGroq: jest.fn() }));
import { telegramTrust, valuesPercent, validQuizAnswers, QUIZ, voiceMarker } from "../match/extras";

describe("Telegram-account verification", () => {
  test("needs a public @username or Telegram Premium", () => {
    expect(telegramTrust({ username: "abc" }).ok).toBe(true);
    expect(telegramTrust({ isPremium: true }).ok).toBe(true);
    expect(telegramTrust({}).ok).toBe(false);
  });
});
describe("values quiz", () => {
  const a = [0, 0, 0, 0, 0, 0];
  test("identical answers are 100, opposite on ordered questions lower", () => {
    expect(valuesPercent(a, a)).toBe(100);
    expect(valuesPercent(a, [1, 0, 0, 0, 0, 0])).toBe(92);   // one ordered question one step apart = half credit
    expect(valuesPercent(a, [2, 2, 2, 2, 2, 2])).toBe(0);
  });
  test("answers must cover every question within range", () => {
    expect(validQuizAnswers(a)).toBe(true);
    expect(validQuizAnswers([0, 0, 0])).toBe(false);
    expect(validQuizAnswers(QUIZ.map((q) => q.options.length))).toBe(false);
  });
});
test("voice marker is the format the chat renders", () => { expect(voiceMarker(12, 7)).toBe("🎤voice:12:7"); });
