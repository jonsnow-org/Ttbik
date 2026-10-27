import { shamMediaRoute, setShamMediaRoute, shamMediaOrder, setShamMediaOrder, type ShamMediaRoute } from "@/lib/shamExec";
import type { Db } from "@/lib/coderAuth";

function settingsDb(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const db = {
    exec: async (sql: string, ...args: unknown[]) => {
      if (sql.includes("'media_route_v3'")) values.set("media_route_v3", String(args[0]));
      else if (sql.includes("'media_order_v2'")) values.set("media_order_v2", String(args[0]));
    },
    query: async (sql: string) => {
      const key = sql.includes("media_route_v3") ? "media_route_v3" : sql.includes("media_order_v2") ? "media_order_v2" : "";
      const value = values.get(key);
      return value === undefined ? [] : [{ value }];
    },
  };
  return db as unknown as Db;
}

describe("Sham's three media routes", () => {
  it("defaults to Sham v2 and persists each of the three choices", async () => {
    const db = settingsDb();
    expect(await shamMediaRoute(db)).toBe("sham_v2");
    for (const route of ["sham_v1", "sham_v2", "nova_media"] as ShamMediaRoute[]) {
      await setShamMediaRoute(route, db);
      expect(await shamMediaRoute(db)).toBe(route);
    }
  });

  it("migrates the previous two-way setting without losing the selected Studio", async () => {
    expect(await shamMediaRoute(settingsDb({ media_order_v2: "reserve_first" }))).toBe("nova_media");
    expect(await shamMediaRoute(settingsDb({ media_order_v2: "own_first" }))).toBe("sham_v2");
  });

  it("keeps the old binary API compatible", async () => {
    const db = settingsDb();
    await setShamMediaOrder("reserve_first", db);
    expect(await shamMediaRoute(db)).toBe("nova_media");
    expect(await shamMediaOrder(db)).toBe("reserve_first");
    await setShamMediaOrder("own_first", db);
    expect(await shamMediaRoute(db)).toBe("sham_v2");
    expect(await shamMediaOrder(db)).toBe("own_first");
  });
});
