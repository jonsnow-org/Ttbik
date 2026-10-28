import { coderTools, coderToolsFor, loadedGroups, runTool, toolGroups } from "@/lib/coderAgent";
import { maxParallelAgentsForStudios } from "@/lib/coderAgents";

const names = (ts: { function: { name: string } }[]) => ts.map((t) => t.function.name);

const oldPrimary = process.env.OPEN_CODER_STUDIO_URL;
const oldReplicas = process.env.OPEN_CODER_STUDIO_URLS;
beforeAll(() => {
  process.env.CODER_TOOL_GROUPS = "lazy";
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.OPEN_CODER_STUDIO_URLS = "https://coder2.test,https://coder3.test,https://coder4.test,https://coder5.test";
});
afterAll(() => {
  delete process.env.CODER_TOOL_GROUPS;
  if (oldPrimary === undefined) delete process.env.OPEN_CODER_STUDIO_URL; else process.env.OPEN_CODER_STUDIO_URL = oldPrimary;
  if (oldReplicas === undefined) delete process.env.OPEN_CODER_STUDIO_URLS; else process.env.OPEN_CODER_STUDIO_URLS = oldReplicas;
});

describe("agent capacity follows actual Nova Studio count", () => {
  it("does not start agents on one Studio and avoids nested overbooking", () => {
    expect(maxParallelAgentsForStudios(0)).toBe(0);
    expect(maxParallelAgentsForStudios(1)).toBe(0);
    expect(maxParallelAgentsForStudios(2)).toBe(2);
    expect(maxParallelAgentsForStudios(5)).toBe(5);
    expect(maxParallelAgentsForStudios(5, true)).toBe(1);
  });
});

describe("fixed tool list (default)", () => {
  beforeAll(() => { delete process.env.CODER_TOOL_GROUPS; });
  afterAll(() => { process.env.CODER_TOOL_GROUPS = "lazy"; });
  it("every step carries the same list: ask_user, delegate, then all groups; no load_tools", () => {
    const a = coderToolsFor(true, false, [{ role: "user", content: "x" }]);
    const b = coderToolsFor(true, false, [{ role: "user", content: "y" }, { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "web_search", arguments: "{}" } }] } as any], ["web"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(names(a).slice(0, 2)).toEqual(["ask_user", "delegate"]);
    expect(names(a)).toContain("github_repo_audit");
    expect(names(a)).not.toContain("load_tools");
    expect(names(a)).toEqual(expect.arrayContaining(["github_write_files", "sandbox_exec", "web_search", "memory_note", "schedule_create", "make_media"]));
  });
  it("compact: shorter texts, the same tools, parameters, types, enums and required lists", () => {
    const whole = coderToolsFor(true, true, []);
    process.env.CODER_TOOLS_COMPACT = "on";
    const small = coderToolsFor(true, true, []);
    delete process.env.CODER_TOOLS_COMPACT;
    expect(names(small)).toEqual(names(whole));
    expect(JSON.stringify(small).length).toBeLessThan(JSON.stringify(whole).length);
    const strip = (x: any): any => Array.isArray(x) ? x.map(strip) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "description").map(([k, v]) => [k, strip(v)])) : x;
    for (let i = 0; i < small.length; i++) expect(strip((small[i].function.parameters))).toEqual(strip((whole[i].function.parameters)));
    expect(small.every((t) => (t.function.description || "").length <= 175)).toBe(true);
  });
});

describe("tool groups the model loads itself (CODER_TOOL_GROUPS=lazy)", () => {
  it("a fresh conversation carries only load_tools, ask_user and delegate, with the groups available here", () => {
    const t = coderToolsFor(true, false, [{ role: "user", content: "من انت" }]);
    expect(names(t)).toEqual(["load_tools", "ask_user", "delegate"]);
    const en = (t[0].function.parameters as any).properties.groups.items.enum;
    expect(en).toEqual(expect.arrayContaining(["github", "computer", "web", "memory"]));
    expect(en).not.toContain("connectors");
    expect(JSON.stringify(t).length).toBeLessThan(JSON.stringify(coderTools(true)).length / 8);   // load_tools + ask_user + delegate: a few hundred characters against ~40 schemas
  });
  it("no github group without GitHub", () => {
    const en = (coderToolsFor(false, false, [])[0].function.parameters as any).properties.groups.items.enum;
    expect(en).not.toContain("github");
  });
  it("loaded and already-used groups stay for the conversation", () => {
    const msgs: any[] = [
      { role: "user", content: "x" },
      { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "load_tools", arguments: '{"groups":["github"]}' } }] },
      { role: "tool", content: "loaded: github", tool_call_id: "1" },
      { role: "assistant", content: "", tool_calls: [{ id: "2", type: "function", function: { name: "web_search", arguments: '{"query":"q"}' } }] },
    ];
    expect([...loadedGroups(msgs, toolGroups(true))].sort()).toEqual(["github", "web"]);
    const n = names(coderToolsFor(true, false, msgs));
    expect(n).toContain("github_write_files");
    expect(n).toContain("fetch_page");
    expect(n).not.toContain("sandbox_exec");
    expect(n).toContain("load_tools");
  });
  it("every group loaded: load_tools itself is gone, all tools present", () => {
    const msgs: any[] = [{ role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "load_tools", arguments: '{"groups":["github","computer","web","media","memory","schedule"]}' } }] }];
    expect(names(coderToolsFor(true, false, msgs)).sort()).toEqual(names(coderTools(true)).sort());
  });
  it("CODER_TOOL_GROUPS=off sends every tool", () => {
    process.env.CODER_TOOL_GROUPS = "off";
    try { expect(names(coderToolsFor(true, false, []))).toEqual(names(coderTools(true))); } finally { process.env.CODER_TOOL_GROUPS = "lazy"; }
  });
  it("load_tools answers what was loaded", async () => {
    const ctx: any = { gh: null, addNote: () => {} };
    expect(await runTool({ function: { name: "load_tools", arguments: '{"groups":["web","github"]}' } }, ctx)).toMatch(/^loaded: web\..*Not available here: github/);
    expect(await runTool({ function: { name: "load_tools", arguments: '{"groups":["nope"]}' } }, ctx)).toMatch(/^error/);
  });
  it("groups used before a segment break stay loaded (keep), so the next segment does not spend a step on load_tools again", () => {
    const fresh: any[] = [{ role: "user", content: "تابع من الملخص" }];
    expect(names(coderToolsFor(true, false, fresh))).not.toContain("web_search");
    const n = names(coderToolsFor(true, false, fresh, ["web", "memory"]));
    expect(n).toEqual(expect.arrayContaining(["web_search", "fetch_page", "memory_note"]));
    expect(n).not.toContain("github_write_files");                      // only the kept groups
    expect(names(coderToolsFor(true, false, fresh, ["nope"]))).not.toContain("web_search");
  });
  it("github_search_repos finds repositories of any owner and lists them compactly", async () => {
    const seen: string[] = [];
    const gh = async (method: string, path: string) => {
      seen.push(`${method} ${path}`);
      return { status: 200, data: { items: [{ full_name: "a/tg-llm", stargazers_count: 120, language: "Python", pushed_at: "2026-10-01T00:00:00Z", description: "Telegram LLM bot" }, { full_name: "b/bot", stargazers_count: 5, language: null, pushed_at: "2026-09-01T00:00:00Z", description: null }] } };
    };
    const out = await runTool({ function: { name: "github_search_repos", arguments: '{"query":"telegram bot llm language:python","sort":"stars"}' } }, { gh, addNote: () => {} } as any);
    expect(seen[0]).toMatch(/^GET \/search\/repositories\?q=telegram%20bot%20llm%20language%3Apython&sort=stars&order=desc&per_page=15$/);
    expect(out).toContain("a/tg-llm ★120 Python (updated 2026-10-01) Telegram LLM bot");
    expect(out).toContain("b/bot ★5 -");
    expect(await runTool({ function: { name: "github_search_repos", arguments: "{}" } }, { gh, addNote: () => {} } as any)).toMatch(/^error/);
    expect(names(coderTools(true))).toContain("github_search_repos");
  });
});

import { researchQuestion } from "@/lib/coderAgent";
describe("researchQuestion: when a message is a plain research request", () => {
  it("recognises 'go and find out' requests", () => {
    expect(researchQuestion("اذهب وابحث على جيتهوب عن مشاريع ذكاء اصطناعي تستخدم تلجرام كواجهة وحلل كيف حلوا التأخر")).not.toBe("");
    expect(researchQuestion("research how open source Telegram AI bots handle rate limits and message size")).not.toBe("");
    expect(researchQuestion("قارن بين أفضل مكتبات بوتات تلجرام بايثون من حيث الأداء")).not.toBe("");
  });
  it("leaves writing, scheduling, own-repo and short chat messages alone", () => {
    expect(researchQuestion("مرحبا كيف حالك")).toBe("");
    expect(researchQuestion("اكتب لي دالة بايثون تبحث عن أكبر رقم في قائمة مع شرح مفصل")).toBe("");
    expect(researchQuestion("ابحث في مستودعي عن الملفات الكبيرة وأخبرني بأسمائها")).toBe("");
    expect(researchQuestion("كل يوم الساعة 9 ابحث عن أخبار الذكاء الاصطناعي ولخصها لي")).toBe("");
    expect(researchQuestion("ابحث عن الخطأ في github.com/acme/site وأصلحه وادفع التعديل")).toBe("");
    expect(researchQuestion("x".repeat(2000))).toBe("");
  });
});

describe("githubQuery", () => {
  const { githubQuery } = require("@/lib/coderAgent");
  it("drops 'GitHub' and filler, searches names and descriptions, asks for stars", () => {
    expect(githubQuery("GitHub AI Telegram bot projects")).toBe("ai telegram bot in:name,description stars:>20");
    expect(githubQuery("Telegram bot message size optimization")).toBe("telegram bot message in:name,description stars:>20");
  });
  it("leaves a query that already has qualifiers alone", () => {
    expect(githubQuery("telegram bot language:python stars:>500")).toBe("telegram bot language:python stars:>500");
  });
});

describe("one context size for every budget", () => {
  const ctx = require("@/lib/coderContext");
  afterEach(() => { ctx.forgetStudioCtx(); delete process.env.CODER_CTX_TOKENS; });
  it("at the old 32,768 tokens every budget keeps its old value", () => {
    expect(ctx.ctxTokens()).toBe(32768);
    expect(ctx.historyChars()).toBe(24000);                 // the history window is capped (slow CPU reads), the other budgets keep their old values
    expect(ctx.segmentCharsFor()).toBe(52500);
    expect(ctx.reportsHardChars()).toBe(60000);
  });
  it("they all follow the Studios' own context, and the smallest Studio wins", () => {
    ctx.noteStudioCtx("https://a", 131072);
    expect(ctx.reportsHardChars()).toBe(240000);
    ctx.noteStudioCtx("https://b", 65536);
    expect(ctx.ctxTokens()).toBe(65536);
    expect(ctx.historyChars()).toBe(24000);                 // a bigger context does not make the model re-read more history
    expect(ctx.reportsHardChars()).toBe(120000);
    process.env.CODER_HISTORY_CHARS = "80000";
    expect(ctx.historyChars()).toBe(80000);
    delete process.env.CODER_HISTORY_CHARS;
  });
  it("CODER_CTX_TOKENS forces a value; nonsense is ignored", () => {
    process.env.CODER_CTX_TOKENS = "98304";
    expect(ctx.ctxTokens()).toBe(98304);
    process.env.CODER_CTX_TOKENS = "5";
    expect(ctx.ctxTokens()).toBe(32768);
  });
});
