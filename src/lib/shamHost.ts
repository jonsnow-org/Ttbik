// THE ONLY FILE where Sham meets the platform services it runs on (web access, the VM driver, limits, memory, schedules, the user's connections).
// Sham's own modules (sham*.ts) never import Nova's engine or tools; they call this adapter through the ShamHost interface (shamExec.ts).
// A boundary test (shamBoundary.test.ts) fails if any other sham*.ts file imports a coder* / openCoder* / nova* module, or any Nova module imports Sham's.
import { deepResearch, fetchPage, formatResearch, formatSearch, webSearch } from "@/lib/coderWeb";
import { runSandboxTool, SANDBOX_TOOLS } from "@/lib/coderSandbox";
import { prismaDb as platformDb, resolveConnections, tierFor, coderChatKey, type Db as PlatformDb } from "@/lib/coderAuth";
import { checkLimit, addUsage } from "@/lib/coderPlans";
import { connectedIds, connectorApi, mcpRequest } from "@/lib/coderConnectors";
import { memoryTool } from "@/lib/coderMemory";
import * as S from "@/lib/coderSchedules";
import { prismaDb as shamDb } from "@/lib/shamDb";
import type { ShamHost } from "@/lib/shamExec";

/** Sham's own db handle stands for the platform's real one, so the platform creates its tables as usual; a test double passes through. */
const d = (db: unknown): PlatformDb => (db === shamDb ? platformDb : (db as PlatformDb));

export const shamHost: ShamHost = {
  web: {
    search: async (q, o) => formatSearch(q, await webSearch(q, o)),
    page: async (url, o) => {
      const p = await fetchPage(url, o);
      return { ok: p.ok, url: p.url, error: p.error, text: p.ok ? `${p.title ? `# ${p.title}\n` : ""}${p.url}\n\n${p.markdown}` : "" };
    },
    research: async (q, o) => formatResearch(await deepResearch(q, o), 24000),
  },
  sandbox: { has: (n) => SANDBOX_TOOLS.has(n), run: (name, args, c) => runSandboxTool(name, args, { ...c, db: d(c.db) }) },
  account: async (chatId, db) => {
    const conn = await resolveConnections(chatId, d(db));
    const connectors = (await connectedIds(chatId, d(db)).catch(() => [] as string[])).filter((x) => x !== "github");
    return { githubToken: conn.github?.token || null, owner: tierFor(chatId) === "owner", chatKey: coderChatKey(chatId), connectors };
  },
  connectors: {
    api: (chatId, a, db, f) => connectorApi(chatId, a, d(db), f),
    mcp: (chatId, server, method, params, db, f) => mcpRequest(chatId, server, method, params, d(db), f),
  },
  limits: {
    ok: async (chatId, metric, amount, db) => (await checkLimit(chatId, metric, amount, d(db))).ok,
    add: (chatId, metric, amount, db) => addUsage(chatId, metric, amount, d(db)),
  },
  memory: (chatId, tool, args, runId, db) => memoryTool(chatId, tool, args, runId, d(db)),
  schedules: {
    list: async (chatId, db) => {
      const rows = await S.listSchedules(chatId, d(db));
      return rows.length ? rows.map((r) => `${r.id} | ${r.title} | ${S.publicSchedule(r, "ar").describe}${r.paused ? " (paused)" : ""} | next: ${r.next_run_at || "-"}`).join("\n") : "no schedules";
    },
    remove: async (chatId, id, db) => (await S.deleteSchedule(chatId, id, true, d(db))) === "deleted",
    create: async (chatId, botId, args, db) => {
      const r = await S.createSchedule(chatId, botId, args as never, d(db));
      return r.ok ? `scheduled ${r.schedule.id}: ${S.publicSchedule(r.schedule, "ar").describe}` : `error: ${r.error}`;
    },
  },
};
