// The owner's full path, end to end, on Nova's REAL loop (handleCoderSections → driveLoop) with a GitHub layer that behaves
// like the real API: a repository tree, file contents, code search with text matches, ref lookup and ref creation.
//
// The reference state (live 2026-11-24):
//   1. «اذهب لمستودعنا على جيتهوب موقع شام آي بوت سلاسل يومية @Slaselbot … اصلاح … تطوير التطبيق المصغر»
//   2. Nova lists the account's repositories and asks which one.
//   3. The owner answers: «هذا بوت تلجرام وليس مستودع وهو موجود في مستودعنا jonsnow-org/Ttbik»
//   4. (the live failure) the task died: «تعذّر تكوين جواب مناسب لهذه الرسالة» three times, nothing changed.
//
// What this file holds:
//   - after the correction Nova does NOT ask about the repository again: it searches INSIDE jonsnow-org/Ttbik for the bot
//     handle, reads the matching code and the next relevant implementation file on the established branch, without creating a branch;
//   - the engine placeholder never reaches the chat and no blocked reply ends the task;
//   - «تابع» resumes from the next real step;
//   - the repair context (the repository the owner named) really reaches the model, and the prompt carries the NAME RULE.
import { handleCoderSections, loadState } from "@/lib/coderSections";
import { NOVA_STALE_AR } from "@/lib/novaReplyGuard";
import { fakeBot, fakeDb } from "./coderFakes";

jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

const CHAT = 4242;
const REPO = "jonsnow-org/Ttbik";
const BRANCH = "claude/free-services-marketplace-h6rwk2";
const OWNER_MESSAGE = "اذهب لمستودعنا على جيتهوب موقع شام آي بوت سلاسل يومية @Slaselbot\nقم بتحليل البوت وتطبيقه المصغر بشكل كامل\nوقم باصلاح اخطاء البوت والتطبيق وقم بتطوير التطبيق المصغر بشكل احترافي\nواثناء عملك سجل ملاحظة بكل ماتجد انك تحتاجه او ينقصك من ادوات وغيره ويساعدك على اتمام عملك بشكل افضل";
const CORRECTION = "هذا بوت تلجرام وليس مستودع وهو موجود في مستودعنا jonsnow-org/Ttbik";
const ASKED = "المستودعات المرتبطة بحسابك:\n1. jonsnow-org/Ttbik\n2. jonsnow-org/Lena9\n\nهل البوت موجود في أحد هذه المستودعات؟ أم أن اسم المستودع مختلف عن \"@Slaselbot\"؟";

// A small repository that answers like GitHub does: the handle lives in two files of the real project.
const FILES: Record<string, string> = {
  "README.md": "# Ttbik\nSham AI site, bots and mini apps.\n",
  "package.json": '{"name":"ttbik","private":true}\n',
  "src/lib/botApp/streakApp.ts": 'export const STREAK_BOT_USERNAME = "Slaselbot";\nexport function streakApp() { return STREAK_BOT_USERNAME; }\n',
  "src/config/navigation.ts": 'export const BOT_LINK = "https://t.me/Slaselbot";\n',
  "src/lib/streakBotLogic.ts": "export const streakDays = 0;\n",
  "src/app/bot-app/[botId]/StreakMiniApp.tsx": "export default function StreakMiniApp() { return null; }\n",
};

type Call = { method: string; path: string; body?: any; headers?: any };
/** The messages the Studio received (the wire sends them as JSON text). */
const wire = (body: any): any[] => (typeof body?.messages === "string" ? JSON.parse(body.messages) : (body?.messages || []));
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const call = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

/** GitHub as the real API behaves (tree, contents, code search with text matches, refs). Records every request. */
function githubLayer() {
  const ghCalls: Call[] = [];
  const handle = (method: string, path: string, body?: any): [number, any] | null => {
    const repoMatch = path.match(/^\/repos\/([^/]+\/[^/?]+)(\/.*)?$/);
    if (path.startsWith("/user/repos")) {
      return [200, [
        { full_name: REPO, default_branch: BRANCH, private: true },
        { full_name: "jonsnow-org/Lena9", default_branch: "main", private: true },
        { full_name: "jonsnowx1r-lab/sham-coder-runner", default_branch: "main" },
      ]];
    }
    if (path.startsWith("/search/code")) {
      const q = decodeURIComponent((path.match(/[?&]q=([^&]*)/) || [])[1] || "");
      const term = q.replace(/repo:\S+/g, "").trim();
      const inRepo = q.includes(`repo:${REPO}`);
      if (!inRepo) return [200, { total_count: 0, items: [] }];
      const items = Object.entries(FILES)
        .filter(([, text]) => text.toLowerCase().includes(term.toLowerCase()))
        .map(([p, text]) => ({ path: p, text_matches: [{ fragment: text.split("\n").find((l) => l.toLowerCase().includes(term.toLowerCase())) || "" }] }));
      return [200, { total_count: items.length, items }];
    }
    if (!repoMatch) return null;
    const repo = repoMatch[1];
    if (repo !== REPO) return [404, { message: "Not Found" }];
    const rest = repoMatch[2] || "";
    if (!rest) return [200, { full_name: REPO, default_branch: BRANCH, private: true, description: "Sham AI", open_issues_count: 3 }];
    const tree = rest.match(/^\/git\/trees\/([^?]+)/);
    if (tree && method === "GET") {
      return [200, { sha: "tree-sha", truncated: false, tree: Object.keys(FILES).concat(["src/lib"]).map((p) => ({ path: p, type: p.includes(".") ? "blob" : "tree", size: p.includes(".") ? FILES[p].length : 0 })) }];
    }
    const refRead = rest.match(/^\/git\/ref\/heads\/(.+)$/);
    if (refRead && method === "GET") return [200, { ref: `refs/heads/${refRead[1]}`, object: { sha: "0f1e2d3c4b5a69788796a5b4c3d2e1f00a1b2c3d" } }];
    if (rest === "/git/refs" && method === "POST") return [201, { ref: body?.ref, object: { sha: body?.sha } }];
    const contents = rest.match(/^\/contents\/(.+)$/);
    if (contents && method === "GET") {
      const p = decodeURIComponent(contents[1]).split("?")[0];
      const text = FILES[p];
      if (text === undefined) return [404, { message: "Not Found" }];
      return [200, { type: "file", path: p, sha: "sha-" + p.length, size: text.length, encoding: "base64", content: Buffer.from(text, "utf8").toString("base64") }];
    }
    return null;
  };
  return { ghCalls, handle };
}

/** The Studio: a scripted model that behaves like the reference conversation, choosing its step from what it was just given. */
function studio(gh: ReturnType<typeof githubLayer>) {
  const bodies: any[] = [];
  const pending = new Map<string, object>();
  let afterFollow = false;
  let readBatch = 0;
  const toolResultName = (msgs: any[]): string => {
    const last = msgs[msgs.length - 1];
    if (last?.role !== "tool") return "";
    const prev = [...msgs].slice(0, -1).reverse().find((m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length);
    return String(prev?.tool_calls?.[0]?.function?.name || last?.name || "");
  };
  const decide = (body: any): object => {
    const msgs: any[] = wire(body);
    const lastUser = [...msgs].reverse().find((m) => m.role === "user" && typeof m.content === "string");
    const userText = String(lastUser?.content || "");
    const tool = toolResultName(msgs);
    if (userText.trim().startsWith("تابع")) afterFollow = true;   // the harness may append its own context block to the message
    if (tool === "github_search_code") {
      // the search ran: read the files it returned, exactly as Nova's own instruction says
      return { type: "done", job: "j2", text: "", tool_calls: [call("r1", "github_read_files", { repo: REPO, paths: ["src/lib/botApp/streakApp.ts", "src/config/navigation.ts"] })] };
    }
    if (tool === "github_read_files") {
      if (afterFollow) {
        return { type: "done", job: "j5", text: "قرأت src/app/bot-app/[botId]/StreakMiniApp.tsx: التطبيق المصغر يستخدم مكوّن السلاسل اليومي، والآن اكتملت خريطة المسار دون إنشاء فرع جديد.", tool_calls: [] };
      }
      readBatch += 1;
      return readBatch === 1
        ? { type: "done", job: "j3", text: "", tool_calls: [call("r2", "github_read_files", { repo: REPO, paths: ["src/lib/streakBotLogic.ts"] })] }
        : { type: "done", job: "j4", text: "وجدت البوت داخل المستودع: المعرّف @Slaselbot مضبوط في src/lib/botApp/streakApp.ts وفي src/config/navigation.ts، وقرأت أيضاً منطق السلاسل اليومية في src/lib/streakBotLogic.ts. تابعت على الفرع المعتمد دون إنشاء فرع آخر.", tool_calls: [] };
    }
    if (tool === "github_list_repos") return { type: "done", job: "j1", text: ASKED, tool_calls: [] };
    if (userText.includes("هذا بوت تلجرام")) {
      return { type: "done", job: "j1b", text: "", tool_calls: [call("s1", "github_search_code", { repo: REPO, query: "Slaselbot" })] };
    }
    if (afterFollow) {
      return { type: "done", job: "j4b", text: "", tool_calls: [call("r3", "github_read_files", { repo: REPO, paths: ["src/app/bot-app/[botId]/StreakMiniApp.tsx"] })] };
    }
    if (userText.includes("@Slaselbot")) {
      return { type: "done", job: "j0", text: "", tool_calls: [call("l1", "github_list_repos", {})] };
    }
    return { type: "done", job: "jx", text: ASKED, tool_calls: [] };     // a repeat of the question: the guard sees it as an echo
  };
  (global as any).fetch = jest.fn(async (url: string, init?: any) => {
    const method = String(init?.method || "GET").toUpperCase();
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    if (url.startsWith("https://api.github.com")) {
      const path = url.slice("https://api.github.com".length);
      gh.ghCalls.push({ method, path, body, headers: init?.headers });
      const out = gh.handle(method, path, body);
      return new Response(JSON.stringify(out ? out[1] : { message: "Not Found" }), { status: out ? out[0] : 404 });
    }
    if (url.endsWith("/api/coder/continue")) return new Response("{}", { status: 202 });
    if (url.includes("/gradio_api/call/v2/status")) return new Response(JSON.stringify({ event_id: `status${bodies.length}` }), { status: 200 });
    if (url.includes("/gradio_api/call/status/")) return new Response(sse({ phase: "ready", queue: 0, model: "coder" }), { status: 200 });
    if (url.includes("/gradio_api/call/v2/chat")) {
      bodies.push(body);
      const id = `e${bodies.length}`;
      pending.set(id, decide(body));
      return new Response(JSON.stringify({ event_id: id }), { status: 200 });
    }
    if (url.includes("/gradio_api/call/chat/")) {
      const id = url.slice(url.lastIndexOf("/") + 1);
      return new Response(sse(pending.get(id) || { type: "done", text: "", tool_calls: [] }), { status: 200 });
    }
    return new Response("{}", { status: 202 });
  });
  return { bodies };
}

const settle = async (db: any, max = 160) => { for (let i = 0; i < max && (await loadState(CHAT, db)).run; i++) await new Promise((r) => setTimeout(r, 250)); };

beforeEach(() => {
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.OPEN_CODER_STUDIO_URLS = "https://coder2.test,https://coder3.test,https://coder4.test,https://coder5.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.CODER_GITHUB_TOKEN = "gh";
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(CHAT);
  process.env.CODER_TOKEN_KEY = "test-key";
  process.env.CRON_SECRET = "cron-secret";
  delete process.env.CODER_REPLY_GUARD;
});

it("after the owner names the repository, Nova searches inside it, reads the hits, acts, and resumes on «تابع»", async () => {
  const gh = githubLayer();
  const { bodies } = studio(gh);
  const db = fakeDb();
  const { bot, sent } = fakeBot();

  // 1) the owner's request
  await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: OWNER_MESSAGE } }, db);
  await settle(db);
  expect(gh.ghCalls.some((c) => c.path.startsWith("/user/repos"))).toBe(true);           // it looked at the account, as in the live transcript
  expect(sent.map((s: any) => String(s.text)).join("\n")).toContain("هل البوت موجود");

  // 2) the owner's correction — the phase that used to die
  const eventsBefore = db.t.events.length;
  const ghBefore = gh.ghCalls.length;
  const sentBefore = sent.length;
  await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: CORRECTION } }, db);
  await settle(db);

  const phase2 = gh.ghCalls.slice(ghBefore);
  const search = phase2.filter((c) => c.path.startsWith("/search/code"));
  expect(search.length).toBeGreaterThan(0);
  expect(decodeURIComponent(search[0].path)).toContain("repo:jonsnow-org/Ttbik");
  expect(decodeURIComponent(search[0].path).toLowerCase()).toContain("slaselbot");     // the bot handle is the query, not a repository name
  expect(phase2.some((c) => c.path.includes("/contents/src/lib/botApp/streakApp.ts"))).toBe(true);   // the hits were read
  expect(phase2.some((c) => c.path.includes("/contents/src/lib/streakBotLogic.ts"))).toBe(true); // reads the next implementation file on the same branch
  expect(phase2.some((c) => c.method === "POST" && c.path === `/repos/${REPO}/git/refs`)).toBe(false); // no per-task branch is created

  const phase2Text = sent.slice(sentBefore).map((s: any) => String(s.text)).join("\n");
  expect(phase2Text).not.toContain(NOVA_STALE_AR);                                     // never the engine placeholder
  expect(phase2Text).not.toMatch(/هل البوت موجود|أي مستودع/);                            // it does not ask about the repository again
  const phase2Events = db.t.events.slice(eventsBefore);
  expect(phase2Events.filter((e: any) => /استُبدل ردّ مكرّر/.test(String(e.text)))).toHaveLength(0);   // no blocked reply ended the task
  expect(phase2Text).toContain("src/lib/botApp/streakApp.ts");                          // it reports what it actually found

  // the repair context reaches the model: the correction and the named repository, with the NAME RULE in the system message
  const phase2Bodies = bodies.filter((b) => JSON.stringify(wire(b)).includes("هذا بوت تلجرام"));
  expect(phase2Bodies.length).toBeGreaterThan(0);
  expect(JSON.stringify(wire(phase2Bodies[0]))).toContain(REPO);
  expect(String(wire(phase2Bodies[0])[0]?.content || "")).toMatch(/NAME RULE/);

  // 3) «تابع» resumes from the next real step
  const ghBeforeFollow = gh.ghCalls.length;
  const sentBeforeFollow = sent.length;
  await handleCoderSections(bot, botRow, { message: { chat: { id: CHAT }, text: "تابع" } }, db);
  await settle(db);
  const follow = gh.ghCalls.slice(ghBeforeFollow);
  expect(follow.some((c) => c.path.includes("/contents/src/app/bot-app/[botId]/StreakMiniApp.tsx"))).toBe(true);
  expect(sent.map((s: any) => String(s.text)).join("\n")).not.toContain(NOVA_STALE_AR);
}, 120000);
