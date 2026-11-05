import { novaMediaRouteOrder, setNovaMediaRouteOrder } from "@/lib/novaSettings";
import type { Db } from "@/lib/coderAuth";

function dbFake(initial?: string) {
  let value = initial;
  const sqls: string[] = [];
  const db = {
    exec: async (sql: string, ...args: unknown[]) => {
      sqls.push(sql);
      if (sql.includes("external_media_enabled_v1")) value = String(args[0]);
    },
    query: async (sql: string) => {
      sqls.push(sql);
      return value === undefined ? [] : [{ value }];
    },
  };
  return { db: db as unknown as Db, sqls };
}

describe("Nova media settings isolation", () => {
  it("defaults to Nova internal media and stores the external switch in nova_settings only", async () => {
    const f = dbFake();
    expect(await novaMediaRouteOrder(f.db)).toBe("fallback_first");
    await setNovaMediaRouteOrder("hf_first", f.db);
    expect(await novaMediaRouteOrder(f.db)).toBe("hf_first");
    expect(f.sqls.some((sql) => sql.includes("nova_settings"))).toBe(true);
    expect(f.sqls.some((sql) => sql.includes("sham_settings"))).toBe(false);
  });
});
