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
  it("the current model is the default and visible; Nova 1 and Sham are hidden until the owner turns them on", async () => {
    const db = modelsDb();
    const all = await listModels(db);
    expect(all.map((m) => m.id)).toEqual(["coder", "nova1", "sham", "nova_pro", "sham_loop", "sham_v2"]);
    expect(publicModels(all, undefined).map((m) => m.id)).toEqual(["coder"]);
    expect(effectiveModel(all, "nova1", false).id).toBe("coder");          // a user cannot use a hidden one
    expect(effectiveModel(all, "nova1", true).id).toBe("nova1");           // the owner can try it
    await updateModel("nova1", { visible: true, price_stars: 150 }, db);
    const after = await listModels(db);
    const pub = publicModels(after, "nova1");
    expect(pub.map((m) => [m.id, m.price_stars, m.selected])).toEqual([["coder", null, false], ["nova1", 150, true]]);
    expect(JSON.stringify(pub)).not.toMatch(/serveEnv|URL|visible/);
    await updateModel("coder", { visible: false }, db);                    // the default cannot be hidden
    expect((await listModels(db)).find((m) => m.id === "coder")?.visible).toBe(true);
    await expect(updateModel("nope", { visible: true }, db)).rejects.toThrow();
    expect(ownerModels(after, undefined).find((m) => m.id === "sham")).toMatchObject({ visible: false, ready: true });
    // Sham and Nova Pro are the owner's only: the visible switch can never show them to users
    await updateModel("sham", { visible: true }, db);
    await updateModel("nova_pro", { visible: true }, db);
    const again = await listModels(db);
    expect(publicModels(again, "sham").map((m) => m.id)).toEqual(["coder", "nova1"]);
    expect(effectiveModel(again, "nova_pro", false).id).toBe("coder");
    expect(effectiveModel(again, "nova_pro", true).id).toBe("nova_pro");
  });
});
