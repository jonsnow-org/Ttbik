import { isPlatformOwner, ownerIdList, primaryOwnerId } from "@/lib/platformOwner";
import { tierFor } from "@/lib/coderAuth";

describe("platform owner (admin ids only)", () => {
  const saved = { a: process.env.SUPER_ADMIN_TELEGRAM_ID, b: process.env.TELEGRAM_ADMIN_CHAT_ID, c: process.env.OWNER_IDS };
  afterEach(() => {
    process.env.SUPER_ADMIN_TELEGRAM_ID = saved.a;
    process.env.TELEGRAM_ADMIN_CHAT_ID = saved.b;
    process.env.OWNER_IDS = saved.c;
    if (saved.a === undefined) delete process.env.SUPER_ADMIN_TELEGRAM_ID;
    if (saved.b === undefined) delete process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (saved.c === undefined) delete process.env.OWNER_IDS;
  });

  it("recognizes SUPER_ADMIN_TELEGRAM_ID and TELEGRAM_ADMIN_CHAT_ID as the owner (deny-list exempt tier)", () => {
    process.env.SUPER_ADMIN_TELEGRAM_ID = "111";
    process.env.TELEGRAM_ADMIN_CHAT_ID = "222";
    expect(ownerIdList()).toEqual(["111", "222"]);
    expect(isPlatformOwner(111)).toBe(true);
    expect(isPlatformOwner("222")).toBe(true);
    expect(primaryOwnerId()).toBe("111");
    expect(tierFor(111)).toBe("owner");
    expect(tierFor(999)).toBe("user");
  });

  it("ignores the removed OWNER_IDS list", () => {
    delete process.env.SUPER_ADMIN_TELEGRAM_ID;
    delete process.env.TELEGRAM_ADMIN_CHAT_ID;
    process.env.OWNER_IDS = "333";
    expect(isPlatformOwner("333")).toBe(false);
    expect(isPlatformOwner("")).toBe(false);
  });
});
