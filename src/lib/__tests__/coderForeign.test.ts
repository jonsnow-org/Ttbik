import { stripForeignScript } from "@/lib/coderSections";
import { activeTaskCount } from "@/lib/coderTasks";

describe("foreign script in replies", () => {
  it("preserves every script exactly, including Chinese fragments inside Arabic replies", () => {
    const full = "هذه المشاريع 可能是因为 غير فعالة مثل GitHub Projects";
    expect(stripForeignScript(full, "ابحث لي عن مشاريع")).toBe(full);
    expect(stripForeignScript(full.slice(0, 20), "ابحث")).toBe(full.slice(0, 20));
  });
  it("leaves the text alone when the user wrote Chinese", () => {
    expect(stripForeignScript("你好 world", "你好，请帮我")).toBe("你好 world");
  });
});

describe("activeTaskCount", () => {
  it("never blocks a deploy when the database cannot answer", async () => {
    const db: any = { query: async () => { throw new Error("down"); }, exec: async () => undefined };
    expect(await activeTaskCount(db)).toBe(0);
  });
  it("counts what the query returns", async () => {
    const db: any = { query: async (sql: string) => (/count\(\*\)/.test(sql) ? [{ n: 2 }] : []), exec: async () => undefined };
    expect(await activeTaskCount(db)).toBe(2);
  });
});
