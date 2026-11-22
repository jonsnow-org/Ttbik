// Owner 2026-11-18: every model is independent (Sham, Sham Pro, Nova 1, Nova 2). When the user switches model in the Mini App, every function
// (chats, computer, memory, schedules, T-LDM) is bound to THAT model; nothing calls another model's endpoints, computer or sessions.
import { appOp, AppError } from "@/lib/coderApp";
import { bindingFor, boundBody, computerSessionFor, MODEL_SCOPED_OPS } from "@/lib/miniAppBinding";
import { computerModelOf, computerSessionOf, COMPUTER_MODEL_IDS } from "@/lib/computerModels";
import { modelSessionChatId } from "@/lib/coderSections";
import { modelChatId, tasksOfModel } from "@/lib/coderChats";
import { createThread } from "@/lib/coderThreads";
import { withEngineModel } from "@/lib/openCoderStudio";
import { DEFAULT_V2_URL } from "@/lib/shamStudio";
import { fakeBot } from "./coderFakes";
import { pgDb, resetPg } from "./pgDb";

const OWNER = 4242;
const MODELS = ["coder", "nova2", "sham", "sham_v2"] as const;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const HUB = "https://hub.test";
beforeEach(async () => {
  await resetPg();
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_TOKEN_KEY = "k";
  process.env.COMPUTER_STUDIO_URL = HUB;
  delete process.env.NOVA2_COMPUTER_STUDIO_URL;
  delete process.env.NOVA2_MEDIA_STUDIO_URL;
  delete process.env.SHAM_V2_URL;
  delete process.env.SHAM_MODELSCOPE_URL;
});

/** A Gradio-shaped fake that records which host and which session every call used. */
function recorder() {
  const seen: { host: string; body: any }[] = [];
  const fetchImpl = (async (url: string, init?: any) => {
    const host = new URL(String(url)).origin;
    if (init?.method === "POST") {
      const data = JSON.parse(init.body).data[0];
      seen.push({ host, body: JSON.parse(String(data).startsWith("b64:") ? Buffer.from(String(data).slice(4), "base64").toString("utf8") : data) });
      return new Response('{"event_id":"e1"}', { status: 200 });
    }
    return new Response(`event: complete\ndata: ${JSON.stringify([JSON.stringify({ ok: true, output: "", running: false })])}\n\n`, { status: 200 });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe("client binding table", () => {
  test("switching model changes chats model, computer model and computer session; only Nova opens the thread page; T-LDM only on Sham Pro", () => {
    const b = Object.fromEntries(MODELS.map((m) => [m, bindingFor(m)]));
    for (const m of MODELS) {
      expect(b[m].model).toBe(m);
      expect(b[m].chatsModel).toBe(m);
      expect(b[m].computer.model).toBe(m);                       // nobody borrows another model's computer (Nova 2 used to borrow Nova's)
    }
    expect(new Set(MODELS.map((m) => computerSessionFor(OWNER, m))).size).toBe(MODELS.length);
    expect(computerSessionFor(OWNER, "nova2")).toBe(`${OWNER}:nova2`);
    expect(b.coder.computer.home).toBe("miniapp-hub");
    expect(b.nova2.computer.home).toBe("miniapp-hub");
    expect(b.sham.computer.home).toBe("embedded");
    expect(b.sham_v2.computer.home).toBe("embedded");
    expect(MODELS.filter((m) => b[m].threadPage)).toEqual(["coder"]);
    expect(MODELS.filter((m) => b[m].tldm)).toEqual(["sham_v2"]);
    expect(MODELS.filter((m) => b[m].schedules)).toEqual(["coder"]);
    expect(b.sham.memory).toBe("sham_memory");
    expect(b.nova2.memory).toBe("memories");
    expect(bindingFor("sham_loop").model).toBe("sham");
    expect(bindingFor(undefined).model).toBe("coder");
  });

  test("every model-scoped request names the selected model, even if a stale model id was left in the body", () => {
    for (const m of MODELS) for (const op of MODEL_SCOPED_OPS) {
      expect(boundBody(op, m, { model: m === "coder" ? "sham_v2" : "coder", x: 1 })).toEqual({ model: m, x: 1 });
    }
    expect(boundBody("me", "nova2", { a: 1 })).toEqual({ a: 1, model: "nova2" });
    for (const op of ["connectors", "connector_start", "connector_link", "connector_test", "connector_disconnect", "mcp_add", "mcp_remove", "repos", "github_start", "github_token", "secret_list", "secret_delete", "screen_offer", "handoff_done", "schedules", "schedule_create", "schedule_update", "schedule_pause", "schedule_delete", "schedule_run", "stop", "task_stop", "task_delete", "events", "resolve", "secret_answer"]) {
      expect(boundBody(op, "nova2", { model: "coder" })).toEqual({ model: "nova2" });
    }
  });

  test("computer ids: identity for every model, all on the computer list", () => {
    for (const m of MODELS) { expect(computerModelOf(m)).toBe(m); expect(COMPUTER_MODEL_IDS).toContain(m); }
    expect(computerSessionOf(1, "nova2")).not.toBe(computerSessionOf(1, "coder"));
  });
});

describe("server: per-model computer and sessions", () => {
  test("Nova 2 bootstrap does not expose Nova's GitHub link or OAuth availability", async () => {
    const db: any = pgDb();
    const { bot } = fakeBot();
    const prior = process.env.CODER_GITHUB_TOKEN;
    process.env.CODER_GITHUB_TOKEN = "nova-private-token";
    try {
      const view: any = await appOp({ chatId: OWNER, tier: "owner" }, "me", { model: "nova2" }, { db, bot, botRow } as any);
      expect(view.settings.model).toBe("nova2");
      expect(view.connections).toEqual({ github: { linked: false } });
      expect(view.oauth).toBe(false);
      expect(view.features.computer).toBe(false);
      expect(view.features.tldm).toBe(false);
      const blockedTldm: any = await appOp({ chatId: OWNER, tier: "owner" }, "settings", { model: "nova2", tldm: true }, { db, bot, botRow } as any).catch((e: any) => e);
      expect(blockedTldm).toMatchObject({ status: 403 });
    } finally {
      if (prior === undefined) delete process.env.CODER_GITHUB_TOKEN; else process.env.CODER_GITHUB_TOKEN = prior;
    }
  });

  test("Nova 2's connector page does not expose Nova's linked accounts or MCP list", async () => {
    const db: any = pgDb();
    const { bot } = fakeBot();
    const deps = { db, bot, botRow } as any;
    const view: any = await appOp({ chatId: OWNER, tier: "owner" }, "connectors", { model: "nova2" }, deps);
    expect(view).toMatchObject({ connectors: [], mcp: [], presets: [], isolated: true });
    await expect(appOp({ chatId: OWNER, tier: "owner" }, "mcp_add", { model: "nova2", url: "https://mcp.example.test" }, deps))
      .rejects.toMatchObject({ status: 403 });
  });

  test("Nova 2 cannot write into Nova's linked GitHub account or shared secret vault", async () => {
    const db: any = pgDb();
    const { bot } = fakeBot();
    const deps = { db, bot, botRow } as any;
    for (const op of ["github_start", "github_token", "secret_list", "secret_delete", "secret_answer"]) {
      const result: any = await appOp({ chatId: OWNER, tier: "owner" }, op, { model: "nova2", token: "ghp_" + "x".repeat(24), name: "token" }, deps).catch((e: any) => e);
      expect(result).toMatchObject({ status: 403 });
    }
  });

  test("Nova 2 cannot read or mutate Nova's schedule store", async () => {
    const db: any = pgDb();
    const { bot } = fakeBot();
    const deps = { db, bot, botRow } as any;
    for (const op of ["schedules", "schedule_create", "schedule_run"]) {
      const result: any = await appOp({ chatId: OWNER, tier: "owner" }, op, { model: "nova2", title: "not shared", prompt: "test" }, deps).catch((e: any) => e);
      expect(result).toMatchObject({ status: 403 });
    }
  });

  test("Nova 2 repository picker uses its own GitHub credential, not Nova's", async () => {
    const db: any = pgDb();
    const { bot } = fakeBot();
    const priorNovaToken = process.env.CODER_GITHUB_TOKEN;
    const priorNova2Token = process.env.NOVA2_GITHUB_TOKEN;
    process.env.CODER_GITHUB_TOKEN = "nova-private-token";
    process.env.NOVA2_GITHUB_TOKEN = "nova2-private-token";
    let authorization = "";
    const fetchImpl = (async (_url: string, init?: any) => {
      authorization = String(init?.headers?.Authorization || "");
      return new Response(JSON.stringify([{ id: 1, full_name: "owner/nova2-only", name: "nova2-only", private: true }]), { status: 200 });
    }) as any;
    try {
      const result: any = await appOp({ chatId: OWNER, tier: "owner" }, "repos", { model: "nova2" }, { db, bot, botRow, fetchImpl });
      expect(authorization).toBe("Bearer nova2-private-token");
      expect(result.repos.map((r: any) => r.full_name)).toContain("owner/nova2-only");
    } finally {
      if (priorNova2Token === undefined) delete process.env.NOVA2_GITHUB_TOKEN; else process.env.NOVA2_GITHUB_TOKEN = priorNova2Token;
      if (priorNovaToken === undefined) delete process.env.CODER_GITHUB_TOKEN; else process.env.CODER_GITHUB_TOKEN = priorNovaToken;
    }
  });
  test("box: Nova 2 has its own computer Studio and fails closed until it is configured", async () => {
    const db: any = pgDb(); const { bot } = fakeBot();
    const { seen, fetchImpl } = recorder();
    const d = { db, bot, botRow, fetchImpl } as any;
    const previous = process.env.NOVA2_COMPUTER_STUDIO_URL;
    try {
      delete process.env.NOVA2_COMPUTER_STUDIO_URL;
      const unavailable = await appOp({ chatId: OWNER, tier: "owner" }, "box", boundBody("box", "nova2", { args: { action: "run", command: "true" } }), d);
      expect(unavailable).toMatchObject({ ok: false, error: "this model has no computer Studio" });
      expect(seen).toHaveLength(0);
      process.env.NOVA2_COMPUTER_STUDIO_URL = "https://n2-computer.example.test";
      await appOp({ chatId: OWNER, tier: "owner" }, "box", boundBody("box", "coder", { args: { action: "run", command: "true" } }), d);
      await appOp({ chatId: OWNER, tier: "owner" }, "box", boundBody("box", "nova2", { args: { action: "run", command: "true" } }), d);
      await appOp({ chatId: OWNER, tier: "owner" }, "box", boundBody("box", "sham_v2", { args: { action: "list" } }), d);
      expect(seen[0]).toMatchObject({ host: HUB, body: { session: `${OWNER}:coder` } });
      expect(seen[1]).toMatchObject({ host: "https://n2-computer.example.test", body: { session: `${OWNER}:nova2` } });
      expect(seen[1].host).not.toBe(seen[0].host);
      expect(seen[2].host).toBe(new URL(DEFAULT_V2_URL).origin);
      expect(seen[2].host).not.toBe(HUB);
      expect(seen[2].body).toMatchObject({ session: `${OWNER}:sham_v2` });
    } finally {
      if (previous === undefined) delete process.env.NOVA2_COMPUTER_STUDIO_URL; else process.env.NOVA2_COMPUTER_STUDIO_URL = previous;
    }
  });

  test("desktop: Nova 2 uses its own desktop Studio; Shams keep their embedded desktops", async () => {
    const db: any = pgDb(); const { bot } = fakeBot();
    const { seen, fetchImpl } = recorder();
    const d = { db, bot, botRow, fetchImpl } as any;
    const previous = process.env.NOVA2_COMPUTER_STUDIO_URL;
    try {
      process.env.NOVA2_COMPUTER_STUDIO_URL = "https://n2-computer.example.test";
      for (const m of MODELS) await appOp({ chatId: OWNER, tier: "owner" }, "desktop", boundBody("desktop", m, { args: { action: "status" } }), d).catch(() => null);
      const byModel = Object.fromEntries(seen.map((x) => [String(x.body.session).split(":")[1], x]));
      expect(byModel.coder.host).toBe(HUB);
      expect(byModel.nova2.host).toBe("https://n2-computer.example.test");
      expect(byModel.nova2.host).not.toBe(byModel.coder.host);
      expect(byModel.sham_v2.host).not.toBe(HUB);
      expect(byModel.sham.host).not.toBe(HUB);
      expect(new Set(seen.map((x) => x.body.session)).size).toBe(seen.length);
    } finally {
      if (previous === undefined) delete process.env.NOVA2_COMPUTER_STUDIO_URL; else process.env.NOVA2_COMPUTER_STUDIO_URL = previous;
    }
  });

  test("Nova 2 keeps its own working state, threads and memory id (not Nova's)", () => {
    expect(modelSessionChatId(OWNER, "coder")).toBe(String(OWNER));
    expect(modelSessionChatId(OWNER, "nova2")).toBe(`${OWNER}#model:nova2`);
    expect(withEngineModel("nova2", () => modelSessionChatId(OWNER))).toBe(`${OWNER}#model:nova2`);
    expect(modelChatId(OWNER, "nova2")).toBe(`${OWNER}#model:nova2`);
    expect(modelChatId(OWNER, "coder")).toBe(OWNER);
  });

  test("tasks are listed per model: Nova never sees Nova 2's runs and the Shams see only their own", async () => {
    const db: any = pgDb();
    const novaThread = await createThread(OWNER, { title: "nova" }, db);
    const nova2Thread = await createThread(`${OWNER}#model:nova2`, { title: "nova2" }, db);
    const tasks = [
      { run_id: "a", slot: "", thread_id: novaThread },
      { run_id: "b", slot: "", thread_id: nova2Thread },
      { run_id: "c", slot: "s:0123456789ab", thread_id: null },
      { run_id: "d", slot: "sham_v2", thread_id: null },
      { run_id: "e", slot: "sham_v1", thread_id: null },
    ];
    const ids = async (m: any) => (await tasksOfModel(OWNER, m, tasks, db)).map((t) => t.run_id);
    expect(await ids("coder")).toEqual(["a", "c"]);
    expect(await ids("nova2")).toEqual(["b"]);
    expect(await ids("sham_v2")).toEqual(["d"]);
    expect(await ids("sham")).toEqual(["e"]);
  });

  test("memory ops of a Sham model are refused (Shams keep their own memory); Nova 2's memories are its own", async () => {
    const db: any = pgDb(); const { bot } = fakeBot();
    const d = { db, bot, botRow } as any;
    await expect(appOp({ chatId: OWNER, tier: "owner" }, "memories", { model: "sham_v2" }, d)).rejects.toThrow(AppError);
    await appOp({ chatId: OWNER, tier: "owner" }, "memory_add", { model: "nova2", text: "Nova 2 private preference here" }, d);
    const n2: any = await appOp({ chatId: OWNER, tier: "owner" }, "memories", { model: "nova2" }, d);
    const n1: any = await appOp({ chatId: OWNER, tier: "owner" }, "memories", { model: "coder" }, d);
    expect(n2.memories.map((x: any) => x.text)).toContain("Nova 2 private preference here");
    expect(n1.memories.map((x: any) => x.text)).not.toContain("Nova 2 private preference here");
  });
});

describe("Mini App screens are bound to the selected model (source guard)", () => {
  const fs = require("fs") as typeof import("fs");
  const app = fs.readFileSync(require.resolve("../../app/coder-app/_nova/NovaApp.tsx"), "utf8");
  const computer = fs.readFileSync(require.resolve("../../app/coder-app/_nova/FreeComputer.tsx"), "utf8");
  test("the Computer tab has no model picker and gets the bound model", () => {
    expect(computer).not.toMatch(/COMPUTER_MODEL_OPTIONS/);
    expect(app).toMatch(/<FreeComputer key=\{ctx\.bind\.computer\.model\}[^>]*model=\{ctx\.bind\.computer\.model\}/);
  });
  test("chats, running tasks and stop-all always name the selected model; there is no all-models chat list", () => {
    expect(app).not.toMatch(/model === "all"/);
    expect(app).toMatch(/api<Threads>\("threads", \{ limit: 40, model \}\)/);
    expect(app).toMatch(/api\("chat_new", \{ model \}\)/);
    expect(app).toMatch(/api\("stop_all", \{ model: c\.bind\.model \}\)/);
    expect(app).toMatch(/const model = c\.bind\.chatsModel;/);
  });
  test("every tab remounts on a model switch, so no screen keeps another model's data", () => {
    for (const tag of ["<Home key={bound}", "<Chats key={bound}", "<Settings key={`${lang}:${bound}`}"]) expect(app).toContain(tag);
  });
  test("no Nova name hard-coded in shared rows (they name the selected model)", () => {
    const strings = fs.readFileSync(require.resolve("../../app/coder-app/_nova/strings.ts"), "utf8");
    for (const k of ["h_ask", "h_mem", "s_mem", "toolsSub"]) expect(strings).not.toMatch(new RegExp(`${k}: "[^"]*(نوفا|Nova)`));
  });
});

test("the Mini App has no thinking / speed / forced-mode / T-LDM controls: the models are automatic (owner 2026-11-22); the owner panel keeps only the policy", () => {
  const fs = require("fs") as typeof import("fs");
  const app = fs.readFileSync(require.resolve("../../app/coder-app/_nova/NovaApp.tsx"), "utf8");
  const panel = fs.readFileSync(require.resolve("../../app/coder-app/_nova/OwnerModelsPanel.tsx"), "utf8");
  expect(app).not.toMatch(/setSheet\("(acc|policy|force)"\)/);
  expect(app).not.toMatch(/aria-label="T-LDM"/);
  expect(app).not.toMatch(/m_remember|m_recall|m_save/);            // the three memory switches are gone from the screen
  expect(panel).not.toMatch(/api\("settings", \{ for: "sham_v2", tldm/);
  expect(panel).toMatch(/tldm_policy/);
});
