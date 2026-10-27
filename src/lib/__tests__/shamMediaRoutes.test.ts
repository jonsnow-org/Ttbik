import { shamMediaRoute, setShamMediaRoute, shamMediaOrder, setShamMediaOrder, shamMediaRouteEnabled, setShamMediaRouteEnabled, type ShamMediaRoute } from "@/lib/shamExec";
import type { Db } from "@/lib/coderAuth";

function settingsDb(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const db = {
    exec: async (sql: string, ...args: unknown[]) => {
      if (sql.includes("'media_route_v4'")) values.set("media_route_v4", String(args[0]));
      else if (String(args[0] || "").startsWith("media_enabled_")) values.set(String(args[0]), String(args[1]));
      else if (sql.includes("'media_order_v2'")) values.set("media_order_v2", String(args[0]));
    },
    query: async (sql: string, ...args: unknown[]) => {
      const key = sql.includes("media_route_v4") ? "media_route_v4" : sql.includes("media_route_v3") ? "media_route_v3" : sql.includes("media_order_v2") ? "media_order_v2" : String(args[0] || "").startsWith("media_enabled_") ? String(args[0]) : "";
      const value = values.get(key);
      return value === undefined ? [] : [{ value }];
    },
  };
  return db as unknown as Db;
}

describe("Sham isolated media routes", () => {
  it("defaults to Sham v2 and persists each of the three choices", async () => {
    const db = settingsDb();
    expect(await shamMediaRoute(db)).toBe("sham_v2_ready");
    for (const route of ["sham_v1", "sham_v2_internal", "sham_v2_ready", "sham_v2_hf"] as ShamMediaRoute[]) {
      await setShamMediaRoute(route, db);
      expect(await shamMediaRoute(db)).toBe(route);
    }
  });

  it("stores independent on/off state for each route and defaults to ready weights only", async () => {
    const db = settingsDb();
    expect(await shamMediaRouteEnabled("sham_v2_ready", db)).toBe(true);
    expect(await shamMediaRouteEnabled("sham_v2_hf", db)).toBe(false);
    await setShamMediaRouteEnabled("sham_v2_hf", true, db);
    expect(await shamMediaRouteEnabled("sham_v2_hf", db)).toBe(true);
    await setShamMediaRouteEnabled("sham_v2_ready", false, db);
    expect(await shamMediaRouteEnabled("sham_v2_ready", db)).toBe(false);
  });

  it("migrates old three-way and two-way settings without routing Sham into Nova", async () => {
    expect(await shamMediaRoute(settingsDb({ media_route_v3: "sham_v1" }))).toBe("sham_v1");
    expect(await shamMediaRoute(settingsDb({ media_route_v3: "sham_v2" }))).toBe("sham_v2_ready");
    expect(await shamMediaRoute(settingsDb({ media_route_v3: "nova_media" }))).toBe("sham_v2_hf");
    expect(await shamMediaRoute(settingsDb({ media_order_v2: "reserve_first" }))).toBe("sham_v2_hf");
    expect(await shamMediaRoute(settingsDb({ media_order_v2: "own_first" }))).toBe("sham_v2_ready");
  });

  it("keeps the old binary API compatible", async () => {
    const db = settingsDb();
    await setShamMediaOrder("reserve_first", db);
    expect(await shamMediaRoute(db)).toBe("sham_v2_hf");
    expect(await shamMediaOrder(db)).toBe("reserve_first");
    await setShamMediaOrder("own_first", db);
    expect(await shamMediaRoute(db)).toBe("sham_v2_ready");
    expect(await shamMediaOrder(db)).toBe("own_first");
  });
});
