import { bankAdd, bankRecall, rankBank, resetBankTable } from "@/lib/coderBank";
import { runTool, toolGroups } from "@/lib/coderAgent";

// a tiny table that understands exactly the SQL the bank uses
function bankDb() {
  const rows: any[] = []; let seq = 0;
  return {
    rows,
    exec: async (sql: string, ...p: any[]) => {
      if (/^INSERT INTO coder_task_bank/.test(sql)) rows.push({ run_id: p[0], chat_key: p[1], step: p[2], tool: p[3], label: p[4], body: p[5], seq: ++seq });
      else if (/^DELETE FROM coder_task_bank/.test(sql)) { const keep = rows.filter((r) => r.run_id === p[0]).sort((a, b) => b.seq - a.seq).slice(0, 60).map((r) => r.seq); for (let i = rows.length - 1; i >= 0; i--) if (rows[i].run_id === p[0] && !keep.includes(rows[i].seq)) rows.splice(i, 1); }
    },
    query: async (_sql: string, ...p: any[]) => rows.filter((r) => r.run_id === p[0] && r.chat_key === p[1]).sort((a, b) => b.seq - a.seq),
  } as any;
}
const big = (head: string) => `${head}\n` + "model Order {\n  id Int @id\n  total Decimal\n  customerId Int\n}\n".repeat(30) + "model Invoice {\n  id Int @id\n  paidAt DateTime\n}\n";

describe("the task's read bank", () => {
  beforeEach(() => resetBankTable());
  it("keeps what was read (reads only, never errors or tiny answers) and gives the best piece back for a query", async () => {
    const db = bankDb();
    await bankAdd("r1", "c", 2, "github_read_file", "prisma/schema.prisma", big("// schema"), db);
    await bankAdd("r1", "c", 3, "github_read_file", "src/app.ts", "const x = 1;\n".repeat(40) + "export function startServer() { return listen(3000); }\n", db);
    await bankAdd("r1", "c", 4, "github_read_file", "x", "error 404: not found", db);
    await bankAdd("r1", "c", 5, "github_write_files", "write", "x".repeat(300), db);
    await bankAdd("r1", "c", 6, "github_read_file", "tiny", "ok", db);
    expect(db.rows.map((r: any) => r.label)).toEqual(["prisma/schema.prisma", "src/app.ts"]);
    const out = await bankRecall("r1", "c", "Invoice paidAt", 3, db);
    expect(out).toMatch(/from step 3: prisma\/schema\.prisma/); expect(out).toMatch(/paidAt DateTime/);
    expect(await bankRecall("r1", "c", "startServer listen", 2, db)).toMatch(/src\/app\.ts/);
    expect(await bankRecall("r1", "c", "zzzzqqq", 2, db)).toMatch(/nothing in what this task read matches/);
    expect(await bankRecall("other", "c", "Invoice", 2, db)).toMatch(/nothing has been read/);
    expect(await bankRecall("r1", "c", "", 2, db)).toMatch(/^error: query is required/);
  });
  it("ranks by the query's words, the label counts, and the bank keeps the newest 60", async () => {
    const r = rankBank([{ step: 1, tool: "t", label: "docs/ci.md", body: "nothing here ".repeat(100) }, { step: 2, tool: "t", label: "a.ts", body: "alpha beta gamma\n".repeat(80) }], "gamma ci", 2);
    expect(r[0].label).toBeDefined(); expect(r.length).toBeGreaterThan(0);
    const db = bankDb();
    for (let i = 0; i < 70; i++) await bankAdd("r2", "c", i, "fetch_page", `page ${i}`, `content number ${i} `.repeat(20), db);
    expect(db.rows.length).toBe(60); expect(db.rows[db.rows.length - 1].label).toBe("page 69");
  });
  it("recall is a tool of the memory group and answers through runTool with the task's own key", async () => {
    expect(toolGroups(true, false).memory.map((t) => t.function.name)).toContain("recall");
    const db = bankDb();
    await bankAdd("r3", "tgc:1", 0, "github_read_file", "lib/pay.ts", "export function chargeCard(amount) { return gateway.charge(amount); }\n".repeat(5), db);
    const out = await runTool({ id: "1", type: "function", function: { name: "recall", arguments: JSON.stringify({ query: "chargeCard gateway" }) } }, { gh: null, addNote: () => undefined, runId: "r3", chatKey: "tgc:1", db });
    expect(out).toMatch(/lib\/pay\.ts/); expect(out).toMatch(/chargeCard/);
  });
});
