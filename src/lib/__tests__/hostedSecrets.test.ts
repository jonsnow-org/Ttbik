const rows = new Map<string, string>();
const x = jest.fn(async (sql: string, ...a: unknown[]) => { if (/INSERT INTO hosted_secrets/.test(sql)) rows.set(String(a[0]), String(a[1])); if (/DELETE FROM hosted_secrets/.test(sql)) rows.delete(String(a[0])); return 1; });
const q = jest.fn(async (sql: string, ...a: unknown[]) => (/value_enc/.test(sql) ? (rows.has(String(a[0])) ? [{ value_enc: rows.get(String(a[0])) }] : []) : [...rows.keys()].map((name) => ({ name }))));
jest.mock("@/lib/prisma", () => ({ prisma: { $executeRawUnsafe: (...a: [string, ...unknown[]]) => x(...a), $queryRawUnsafe: (...a: [string, ...unknown[]]) => q(...a) } }));
jest.mock("@/lib/coderAuth", () => ({ tierFor: (id: number) => (id === 42 ? "owner" : "user") }));
import { ALLOWED, getSecret, handleSecretUpdate, open, parseSecretCommand, seal } from "../hostedSecrets";

beforeEach(() => { rows.clear(); x.mockClear(); process.env.CRON_SECRET = "test-key"; delete process.env.CODER_TOKEN_KEY; delete process.env.AI_GITHUB_TOKEN; });
const mkBot = () => { const sent: string[] = []; const deleted: number[] = []; return { sent, deleted, api: { sendMessage: async (_c: number, t: string) => { sent.push(t); }, deleteMessage: async (_c: number, m: number) => { deleted.push(m); } } }; };

describe("hosted secrets", () => {
  test("seal/open round trip; a wrong key or a tampered blob gives null", () => {
    const b = seal("ghp_secretvalue");
    expect(b).not.toContain("secretvalue");
    expect(open(b)).toBe("ghp_secretvalue");
    expect(open(b, { CRON_SECRET: "other" })).toBeNull();
    expect(open(b.slice(0, -4) + "AAAA")).toBeNull();
  });
  test("only AI_* names are allowed", () => {
    expect(ALLOWED.test("AI_GITHUB_TOKEN")).toBe(true);
    for (const n of ["DATABASE_URL", "CRON_SECRET", "ai_x", "AI_", "TELEGRAM_BOT_TOKEN"]) expect(ALLOWED.test(n)).toBe(false);
  });
  test("parses /secret forms", () => {
    expect(parseSecretCommand("/secret")).toEqual({ name: undefined, value: undefined });
    expect(parseSecretCommand("/secret ai_github_token ghp_x")).toEqual({ name: "AI_GITHUB_TOKEN", value: "ghp_x" });
    expect(parseSecretCommand("/secret AI_REPO delete")).toEqual({ name: "AI_REPO", value: "delete" });
    expect(parseSecretCommand("/ai hello")).toBeNull();
  });
  test("the owner stores a secret: message deleted first, reply never contains the value, stored encrypted, read back", async () => {
    const bot = mkBot();
    expect(await handleSecretUpdate(bot, { message: { text: "/secret AI_GITHUB_TOKEN ghp_supersecret", chat: { id: 42 }, message_id: 9 } })).toBe(true);
    expect(bot.deleted).toEqual([9]);
    expect(bot.sent.join("\n")).not.toContain("supersecret");
    expect(bot.sent[0]).toContain("AI_GITHUB_TOKEN");
    expect(rows.get("AI_GITHUB_TOKEN")).not.toContain("supersecret");
    expect(await getSecret("AI_GITHUB_TOKEN")).toBe("ghp_supersecret");
  });
  test("an environment variable wins over the stored value", async () => {
    rows.set("AI_REPO", seal("stored/repo"));
    process.env.AI_REPO = "env/repo";
    expect(await getSecret("AI_REPO")).toBe("env/repo");
    delete process.env.AI_REPO;
  });
  test("anyone else is ignored (false, nothing stored or deleted); disallowed names are refused", async () => {
    const bot = mkBot();
    expect(await handleSecretUpdate(bot, { message: { text: "/secret AI_GITHUB_TOKEN x", chat: { id: 7 }, message_id: 1 } })).toBe(false);
    expect(bot.deleted).toEqual([]); expect(rows.size).toBe(0);
    expect(await handleSecretUpdate(bot, { message: { text: "/secret DATABASE_URL x", chat: { id: 42 }, message_id: 2 } })).toBe(true);
    expect(rows.size).toBe(0);
    expect(bot.sent[bot.sent.length - 1]).toContain("غير مسموح");
  });
  test("delete removes it", async () => {
    const bot = mkBot();
    await handleSecretUpdate(bot, { message: { text: "/secret AI_REPO o/r", chat: { id: 42 }, message_id: 1 } });
    await handleSecretUpdate(bot, { message: { text: "/secret AI_REPO delete", chat: { id: 42 }, message_id: 2 } });
    expect(rows.has("AI_REPO")).toBe(false);
  });
});
