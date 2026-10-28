import type { Db } from "@/lib/coderAuth";
import { effectiveModel, listModels, ownerModels, publicModels, updateModel } from "@/lib/coderModels";

function modelsDb(): Db {
  const rows = new Map<string, any>();
  return {
    exec: async (sql: string, ...a: any[]) => {
      if (sql.includes("INSERT INTO coder_models")) rows.set(a[0], { id: a[0], data: JSON.parse(a[1]) });
      return undefined;
    },
    query: async <T,>(sql: string) => (sql.includes("FROM coder_models") ? [...rows.values()] : []) as T[],
  } as any;
}

describe("coder models", () => {
  it("Nova AI is the default and visible; Sham is hidden until the owner turns it on (one tap), and only when it is ready", async () => {
    const db = modelsDb();
    const all = await listModels(db);
    expect(all.map((m) => m.id)).toEqual(["coder", "sham", "sham_v2"]);               // Nova Pro is gone; Nova 1 is Nova AI's own improvement; the old direct Sham stays to measure its training
    expect(publicModels(all, undefined).map((m) => m.id)).toEqual(["coder"]);
    expect(effectiveModel(all, "sham", false).id).toBe("coder");                    // a user cannot use a hidden one
    expect(effectiveModel(all, "sham", true).id).toBe("sham");                 // the owner can try it
    expect(effectiveModel(all, "sham_loop", true).id).toBe("sham");                      // the former "Sham (advanced)" id is the old Sham now
    expect(effectiveModel(all, "sham_v2", true).id).toBe("sham_v2");                     // the new Sham is its own entry, tried beside the old one
    await updateModel("coder", { visible: false }, db);                                  // Nova has its own switch now (owner panel); the owner can hide it and bring it back
    expect((await listModels(db)).find((m) => m.id === "coder")?.visible).toBe(false);
    await updateModel("coder", { visible: true }, db);
    expect((await listModels(db)).find((m) => m.id === "coder")?.visible).toBe(true);
    await expect(updateModel("nope", { visible: true }, db)).rejects.toThrow();
    delete process.env.MODELSCOPE_API_TOKEN;
    await updateModel("sham", { visible: true, price_stars: 150 }, db);
    const on = await listModels(db);
    expect(publicModels(on, "sham").map((m) => m.id)).toEqual(["coder"]);           // switched on but not ready (no Studio token): still hidden from users
    process.env.MODELSCOPE_API_TOKEN = "t";
    const pub = publicModels(on, "sham");
    expect(pub.map((m) => [m.id, m.price_stars, m.selected])).toEqual([["coder", null, false], ["sham", 150, true]]);
    expect(JSON.stringify(pub)).not.toMatch(/serveEnv|URL|visible/);
    expect(ownerModels(on, undefined).find((m) => m.id === "sham")).toMatchObject({ visible: true, ready: true });
    delete process.env.MODELSCOPE_API_TOKEN;
  });
});
