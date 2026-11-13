import { loadState, saveState, startDonorTestTelegramTask } from "@/lib/coderSections";
import { fakeBot } from "../coderFakes";
import { pgDb, resetPg } from "../pgDb";

const OWNER = 4242;

beforeEach(async () => {
  await resetPg();
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.MODELSCOPE_API_TOKEN = "test-token";
});

test("a retired candidate task is rejected before any external Studio request", async () => {
  const db: any = pgDb();
  await saveState(OWNER, {
    mode: "coder", think: false, messages: [], notes: "", inbox: [], run: null, model: "gemma4-e4b",
  } as any, db);
  const { bot } = fakeBot();
  const fetchImpl = jest.fn();

  await expect(startDonorTestTelegramTask(
    bot, OWNER, "test", "bot1", undefined, db, fetchImpl as unknown as typeof fetch, "telegram", "gemma4-e4b",
  )).rejects.toThrow("candidate models are retired");
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(await loadState(OWNER, db)).toMatchObject({ model: "coder", mode: "coder" });
});
