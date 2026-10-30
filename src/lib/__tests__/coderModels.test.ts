import type { Db } from "@/lib/coderAuth";
import { chooseModel, effectiveModel, listModels, modelReady, ownerModels, publicModels, publicShamSelection, updateModel } from "@/lib/coderModels";

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
  it("preserves an owner's explicit visibility choice made before the Studio token exists", async () => {
    const previous = process.env.MODELSCOPE_API_TOKEN;
    delete process.env.MODELSCOPE_API_TOKEN;
    try {
      const db = modelsDb();
      await db.exec(
        "INSERT INTO coder_models (id, data) VALUES ($1, $2::jsonb)",
        "sham_v2",
        JSON.stringify({ name: { ar: "شام v2 (الجديد)", en: "Sham v2 (new)" }, price_stars: null, visible: false }),
      );
      await listModels(db); // Leave the legacy migration pending while the Studio is unavailable.
      await updateModel("sham_v2", { visible: false }, db); // Explicit owner decision: keep it hidden.
      expect((await listModels(db)).find((m) => m.id === "sham_v2")).toMatchObject({ visible: false, publicRolloutVersion: 1 });

      process.env.MODELSCOPE_API_TOKEN = "test-token";
      const after = await listModels(db);
      expect(after.find((m) => m.id === "sham_v2")).toMatchObject({ visible: false, publicRolloutVersion: 1 });
      expect(publicModels(after, "sham_v2").map((m) => m.id)).not.toContain("sham_v2");
    } finally {
      if (previous === undefined) delete process.env.MODELSCOPE_API_TOKEN;
      else process.env.MODELSCOPE_API_TOKEN = previous;
    }
  });
  it("keeps a legacy hidden Sham v2 row hidden until the Studio token exists", async () => {
    const previous = process.env.MODELSCOPE_API_TOKEN;
    delete process.env.MODELSCOPE_API_TOKEN;
    try {
      const db = modelsDb();
      await db.exec(
        "INSERT INTO coder_models (id, data) VALUES ($1, $2::jsonb)",
        "sham_v2",
        JSON.stringify({ name: { ar: "شام v2 (الجديد)", en: "Sham v2 (new)" }, price_stars: null, visible: false }),
      );
      const before = await listModels(db);
      expect(before.find((m) => m.id === "sham_v2")).toMatchObject({ visible: false, publicRolloutVersion: 0 });
      expect(publicModels(before, "sham_v2").map((m) => m.id)).not.toContain("sham_v2");

      process.env.MODELSCOPE_API_TOKEN = "test-token";
      const after = await listModels(db);
      expect(after.find((m) => m.id === "sham_v2")).toMatchObject({ visible: true, publicRolloutVersion: 1 });
      expect(publicModels(after, "sham_v2").map((m) => m.id)).toContain("sham_v2");
    } finally {
      if (previous === undefined) delete process.env.MODELSCOPE_API_TOKEN;
      else process.env.MODELSCOPE_API_TOKEN = previous;
    }
  });
  it("migrates legacy hidden Sham v2 to public once when the Studio token is configured", async () => {
    const previous = process.env.MODELSCOPE_API_TOKEN;
    process.env.MODELSCOPE_API_TOKEN = "test-token";
    try {
      const db = modelsDb();
      await db.exec(
        "INSERT INTO coder_models (id, data) VALUES ($1, $2::jsonb)",
        "sham_v2",
        JSON.stringify({ name: { ar: "شام v2 (الجديد)", en: "Sham v2 (new)" }, price_stars: null, visible: false }),
      );
      const first = await listModels(db);
      expect(first.find((m) => m.id === "sham_v2")).toMatchObject({ visible: true, publicRolloutVersion: 1 });
      expect(publicModels(first, "sham_v2").map((m) => m.id)).toContain("sham_v2");
      expect(effectiveModel(first, "sham_v2", false).id).toBe("sham_v2");
      await updateModel("sham_v2", { visible: false }, db);
      const second = await listModels(db);
      expect(second.find((m) => m.id === "sham_v2")).toMatchObject({ visible: false, publicRolloutVersion: 1 });
    } finally {
      if (previous === undefined) delete process.env.MODELSCOPE_API_TOKEN;
      else process.env.MODELSCOPE_API_TOKEN = previous;
    }
  });
  it("allows a ready public Sham route independently of Nova, but never when hidden or not ready", async () => {
    const previous = process.env.MODELSCOPE_API_TOKEN;
    try {
      process.env.MODELSCOPE_API_TOKEN = "test-token";
      const db = modelsDb();
      await updateModel("sham_v2", { visible: true }, db); // explicit public rollout, not the hidden default
      let models = await listModels(db);
      expect(publicShamSelection("sham_v2", models)).toBe(true);
      expect(publicShamSelection("coder", models)).toBe(false);
      expect(publicShamSelection("sham_loop", models)).toBe(false); // the old Sham is still owner-only by default

      await updateModel("sham_v2", { visible: false }, db);
      expect(publicShamSelection("sham_v2", await listModels(db))).toBe(false);

      await updateModel("sham_v2", { visible: true }, db);
      delete process.env.MODELSCOPE_API_TOKEN;
      expect(publicShamSelection("sham_v2", await listModels(db))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.MODELSCOPE_API_TOKEN;
      else process.env.MODELSCOPE_API_TOKEN = previous;
    }
  });

  it("treats each private donor Studio as ready only when a ModelScope token is configured", async () => {
    const previousApi = process.env.MODELSCOPE_API_TOKEN;
    const previousFallback = process.env.MODELSCOPE_TOKEN;
    delete process.env.MODELSCOPE_API_TOKEN;
    delete process.env.MODELSCOPE_TOKEN;
    try {
      const all = await listModels(modelsDb());
      const ids = ["qwen35-9b", "gemma4-e4b", "minicpmo45"] as const;
      for (const id of ids) {
        const model = all.find((item) => item.id === id)!;
        expect(modelReady(model)).toBe(false);
        expect(chooseModel({ mode: "coder" }, all, id, true)).toBe(false);
        expect(chooseModel({ mode: "coder" }, all, id, false)).toBe(false);
      }

      process.env.MODELSCOPE_TOKEN = "test-fallback-token";
      for (const id of ids) {
        const model = all.find((item) => item.id === id)!;
        expect(modelReady(model)).toBe(true);
        expect(chooseModel({ mode: "coder" }, all, id, true)).toBe(true);
      }

      delete process.env.MODELSCOPE_TOKEN;
      process.env.MODELSCOPE_API_TOKEN = "test-api-token";
      for (const id of ids) {
        const model = all.find((item) => item.id === id)!;
        expect(modelReady(model)).toBe(true);
      }
    } finally {
      if (previousApi === undefined) delete process.env.MODELSCOPE_API_TOKEN;
      else process.env.MODELSCOPE_API_TOKEN = previousApi;
      if (previousFallback === undefined) delete process.env.MODELSCOPE_TOKEN;
      else process.env.MODELSCOPE_TOKEN = previousFallback;
    }
  });

  it("Nova AI is the default and visible; Sham is hidden until the owner turns it on (one tap), and only when it is ready", async () => {
    const db = modelsDb();
    const all = await listModels(db);
    expect(all.map((m) => m.id)).toEqual(["coder", "sham", "sham_v2", "qwen35-9b", "gemma4-e4b", "minicpmo45"]);               // Nova Pro is gone; Nova 1 is Nova AI's own improvement; the old direct Sham stays to measure its training
    expect(publicModels(all, undefined).map((m) => m.id)).toEqual(["coder"]);
    expect(effectiveModel(all, "sham", false).id).toBe("coder");                    // a user cannot use a hidden one
    expect(effectiveModel(all, "sham", true).id).toBe("sham");                 // the owner can try it
    expect(effectiveModel(all, "sham_loop", true).id).toBe("sham");                      // the former "Sham (advanced)" id is the old Sham now
    expect(effectiveModel(all, "sham_v2", true).id).toBe("sham_v2");                     // the new Sham is its own entry, tried beside the old one
    for (const id of ["qwen35-9b", "gemma4-e4b", "minicpmo45"]) {
      const candidate = all.find((m) => m.id === id);
      expect(candidate).toMatchObject({ ownerOnly: true, lockedOwnerOnly: true, visible: false });
      expect(effectiveModel(all, id, true).id).toBe(id);
      expect(effectiveModel(all, id, false).id).toBe("coder");
    }
    await updateModel("qwen35-9b", { visible: true }, db);
    expect((await listModels(db)).find((m) => m.id === "qwen35-9b")?.visible).toBe(false);
    expect(publicModels(await listModels(db), undefined).map((m) => m.id)).not.toContain("qwen35-9b");
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
    expect(pub.map((m) => [m.id, m.price_stars, m.selected])).toEqual([["coder", null, false], ["sham", 150, true], ["sham_v2", null, false]]);
    expect(JSON.stringify(pub)).not.toMatch(/serveEnv|URL|visible/);
    expect(ownerModels(on, undefined).find((m) => m.id === "sham")).toMatchObject({ visible: true, ready: true });
    delete process.env.MODELSCOPE_API_TOKEN;
  });
});
