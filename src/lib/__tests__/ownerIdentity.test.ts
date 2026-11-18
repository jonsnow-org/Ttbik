import { createHash } from "crypto";
import {
  allOwnerIds,
  configuredOwnerIds,
  excludeFromExperienceAndLogs,
  isPassphraseCandidate,
  isPlatformOwner,
  messageMatchesOwnerPassphrase,
  parseOwnerIdList,
  primaryOwnerId,
  resetOwnerUnlockStateForTests,
  takeOwnerPassphraseMessage,
  _setStoredOwnerIdsForTests,
} from "@/lib/ownerIdentity";

const PHRASE = "unit-test-passphrase-not-used-in-production";
const HASH = createHash("sha256").update(PHRASE, "utf8").digest("hex");

describe("owner identity list", () => {
  const prev: Record<string, string | undefined> = {};
  const keys = ["OWNER_IDS", "OWNER_TELEGRAM_IDS", "OWNER_APP_IDS", "SUPER_ADMIN_TELEGRAM_ID", "TELEGRAM_ADMIN_CHAT_ID", "SHAM_OWNER_PASSPHRASE_HASH", "SHAM_OWNER_PASSPHRASE"];

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    resetOwnerUnlockStateForTests();
  });
  afterEach(() => {
    resetOwnerUnlockStateForTests();
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("parses a list of telegram and app ids from secrets", () => {
    process.env.OWNER_IDS = "111, 222";
    process.env.OWNER_APP_IDS = "app-backup";
    process.env.SUPER_ADMIN_TELEGRAM_ID = "111";
    expect(configuredOwnerIds()).toEqual(["111", "222", "app-backup"]);
    expect(isPlatformOwner("222")).toBe(true);
    expect(isPlatformOwner("app-backup")).toBe(true);
    expect(isPlatformOwner("999")).toBe(false);
    expect(primaryOwnerId()).toBe("111");
  });

  it("includes stored recovered ids", () => {
    process.env.SUPER_ADMIN_TELEGRAM_ID = "111";
    _setStoredOwnerIdsForTests(["555"]);
    expect(allOwnerIds()).toEqual(["111", "555"]);
    expect(isPlatformOwner(555)).toBe(true);
  });

  it("parseOwnerIdList ignores blanks and comments", () => {
    expect(parseOwnerIdList("111\n# skip\n,222")).toEqual(["111", "222"]);
  });
});

describe("owner passphrase unlock", () => {
  const prev: Record<string, string | undefined> = {};
  const keys = ["SHAM_OWNER_PASSPHRASE_HASH", "SHAM_OWNER_PASSPHRASE", "OWNER_IDS", "SUPER_ADMIN_TELEGRAM_ID", "TELEGRAM_ADMIN_CHAT_ID", "OWNER_TELEGRAM_IDS", "OWNER_APP_IDS"];

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    process.env.SHAM_OWNER_PASSPHRASE_HASH = HASH;
    resetOwnerUnlockStateForTests();
  });
  afterEach(() => {
    resetOwnerUnlockStateForTests();
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("matches the whole trimmed message with a constant-time hash compare", () => {
    expect(messageMatchesOwnerPassphrase(`  ${PHRASE}  `)).toBe(true);
    expect(messageMatchesOwnerPassphrase(PHRASE + "x")).toBe(false);
    expect(messageMatchesOwnerPassphrase("hello there friend!!")).toBe(false);
  });

  it("does not treat ordinary Arabic chat as a failed attempt", () => {
    expect(isPassphraseCandidate("مرحبا كيف حالك")).toBe(false);
    expect(excludeFromExperienceAndLogs("مرحبا كيف حالك")).toBe(false);
    expect(isPassphraseCandidate("hello-token-shape-xx")).toBe(true);
  });

  it("unlocks the sending account, deletes the message, and does not echo the phrase", async () => {
    const deleted: number[] = [];
    const replies: string[] = [];
    const out = await takeOwnerPassphraseMessage({
      text: PHRASE,
      accountId: "777",
      chatId: 777,
      deleteMessage: async () => { deleted.push(1); },
      reply: async (t) => { replies.push(t); },
    });
    expect(out).toEqual({ handled: true, unlocked: true, locked: false });
    expect(deleted).toEqual([1]);
    expect(isPlatformOwner("777")).toBe(true);
    expect(replies.join(" ")).not.toContain(PHRASE);
    expect(JSON.stringify(out)).not.toContain(PHRASE);
  });

  it("locks after repeated failed passphrase-like attempts and does not count normal chat", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await takeOwnerPassphraseMessage({
        text: "WrongGuessTokenX" + i,
        accountId: "888",
        chatId: 888,
        deleteMessage: async () => undefined,
      }));
    }
    expect(results[4]).toEqual({ handled: true, unlocked: false, locked: true });
    expect(isPlatformOwner("888")).toBe(false);
    const chat = await takeOwnerPassphraseMessage({
      text: "مرحبا كيف حالك اليوم؟",
      accountId: "888",
      chatId: 888,
    });
    expect(chat.handled).toBe(false);
  });

  it("excludes a matching passphrase from experience and logs", () => {
    expect(excludeFromExperienceAndLogs(PHRASE)).toBe(true);
    expect(excludeFromExperienceAndLogs("WrongGuessTokenXX")).toBe(true);
  });
});
