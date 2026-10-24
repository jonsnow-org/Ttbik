import { claimOrphanTasks, taskStart } from "@/lib/coderTasks";
import { encryptToken } from "@/lib/coderAuth";

beforeEach(() => {
  process.env.CODER_TOKEN_KEY = "test-key";
});

describe("runs orphaned by a replaced server", () => {
  it("taskStart remembers who to resume (the chat id only encrypted) when it knows the bot", async () => {
    const execs: any[][] = [];
    const db: any = {
      exec: async (sql: string, ...a: any[]) => void execs.push([sql, ...a]),
      query: async (sql: string) => (sql.includes("INSERT INTO coder_tasks") ? [{ run_id: "r1" }] : []),
    };
    await taskStart(4242, { runId: "r1", slot: "", source: "interactive", title: "t", botId: "bot1" }, db);
    const upd = execs.find((e) => String(e[0]).includes("SET chat_enc"));
    expect(upd).toBeTruthy();
    expect(upd![2]).not.toContain("4242");
    expect(upd![3]).toBe("bot1");
  });

  it("claims silent running tasks atomically and decrypts their chat; ignores broken rows", async () => {
    const seen: string[] = [];
    const db: any = {
      exec: async () => undefined,
      query: async (sql: string, ...a: any[]) => {
        seen.push(sql);
        if (!sql.includes("UPDATE coder_tasks SET updated_at = now()")) return [];
        expect(sql).toContain("status = 'running'");
        expect(sql).toContain("RETURNING");
        expect(a).toEqual(["90000", String(30 * 60000)]);
        return [
          { run_id: "r1", chat_enc: encryptToken("4242"), bot_id: "bot1", slot: "" },
          { run_id: "r2", chat_enc: encryptToken("4242"), bot_id: "bot1", slot: "s:abc" },
          { run_id: "bad", chat_enc: "garbage", bot_id: "bot1", slot: "" },
        ];
      },
    };
    const out = await claimOrphanTasks(db);
    expect(out).toEqual([
      { run_id: "r1", chatId: 4242, botId: "bot1", slot: "" },
      { run_id: "r2", chatId: 4242, botId: "bot1", slot: "s:abc" },
    ]);
  });
});
