// Per-user confirmation policy (owner's plan, 2026-10-21). For each category of consequential action the user picks:
//   ask   — show ✅/❌ every time (the default)
//   allow — run without asking; the action is still written to the task history
//   deny  — never run; the model is told it was denied and adapts
// A rule may be scoped to one repo and/or one context (interactive chat vs scheduled task). The most specific rule wins.
// Applies to both tiers: with no rule, each tier keeps its standing behaviour (owner: asks only for deletes and main/default writes).
// Stored in coder_permission_prefs (created on first use), keyed by the salted chat hash like the rest of the coder tables.
import { classifyCall, confirmRisks, RISK_LABEL, type Risk } from "@/lib/coderAgent";
import { coderChatKey, prismaDb, type Db, type Tier } from "@/lib/coderAuth";
import type { CoderToolCall } from "@/lib/openCoderStudio";

export type Category = "delete" | "main" | "force" | "deploy" | "settings" | "release" | "external" | "edit" | "merge";
export type Policy = "ask" | "allow" | "deny";
export type Context = "interactive" | "scheduled";
export type PrefRule = { category: Category; repo: string; context: Context | "*"; policy: Policy };

export const CATEGORIES: Category[] = ["delete", "main", "force", "deploy", "settings", "release", "external", "edit", "merge"];
export const CATEGORY_OF: Record<Risk, Category> = {
  delete: "delete",
  push_default: "main", merge_default: "main", push_protected: "main", merge_protected: "main", workflow_writes_default: "main",
  force_push: "force",
  workflow_deploy: "deploy",
  settings: "settings", secrets: "settings", collaborators: "settings",
  release_publish: "release",
  external_write: "external",
  edit: "edit",
  merge: "merge",
};
export const CATEGORY_LABEL: Record<Category, { ar: string; en: string }> = {
  delete: { ar: "الحذف", en: "Delete" },
  main: { ar: "الدفع/الدمج إلى الفرع الأساسي أو المحمي", en: "Push/merge to main, default or protected" },
  force: { ar: "الدفع القسري / إعادة كتابة التاريخ", en: "Force-push / history rewrite" },
  deploy: { ar: "سير عمل ينشر أو يطلق", en: "Deploy / publish workflows" },
  settings: { ar: "إعدادات المستودع والمتعاونون والأسرار", en: "Repo settings, collaborators, secrets" },
  release: { ar: "نشر إصدار", en: "Release publish" },
  external: { ar: "الكتابة في الخدمات المربوطة (نوشن، سلاك، MCP…)", en: "Writes to connected services (Notion, Slack, MCP…)" },
  edit: { ar: "التعديل: كتابة ملفات وإنشاء فروع وطلبات دمج وتعليقات", en: "Edit: write files, create branches, PRs, issues, comments" },
  merge: { ar: "دمج أي طلب دمج (في أي فرع)", en: "Merge any pull request (any branch)" },
};
export const POLICY_LABEL: Record<Policy, { ar: string; en: string }> = {
  ask: { ar: "اسأل كل مرة", en: "Ask every time" },
  allow: { ar: "اسمح تلقائياً", en: "Auto-allow" },
  deny: { ar: "ارفض تلقائياً", en: "Auto-deny" },
};

export const isCategory = (x: unknown): x is Category => CATEGORIES.includes(x as Category);
export const isPolicy = (x: unknown): x is Policy => x === "ask" || x === "allow" || x === "deny";
const REPO_RX = /^[\w.-]+\/[\w.-]+$/;
export function normRepo(repo: unknown): string {
  const r = String(repo || "").trim();
  return r && r !== "*" && REPO_RX.test(r) ? r.toLowerCase() : "*";
}

/** The most specific rule for this category / repo / context, or null (= tier default). */
export function pickRule(rules: PrefRule[], category: Category, repo: string, context: Context): PrefRule | null {
  const r = normRepo(repo);
  let best: PrefRule | null = null;
  let score = -1;
  for (const x of rules) {
    if (x.category !== category) continue;
    const repoHit = x.repo === "*" ? 0 : x.repo === r ? 2 : -1;
    const ctxHit = x.context === "*" ? 0 : x.context === context ? 1 : -1;
    if (repoHit < 0 || ctxHit < 0) continue;
    if (repoHit + ctxHit > score) {
      score = repoHit + ctxHit;
      best = x;
    }
  }
  return best;
}

export type Decision = {
  action: "run" | "ask" | "deny";
  ask: Risk[];               // still needs a tap
  autoAllowed: Risk[];       // would have asked, a rule or "allow for this task" let it through (logged)
  denied: Risk[];            // a rule said deny
  reason: string;            // Arabic labels of what is asked / denied
};

/** Applies tier defaults, then the user's rules, then the per-task allowances (categories allowed with "allow for the rest of this task"). */
export function decide(risks: Risk[], tier: Tier, repo: string, context: Context, rules: PrefRule[], taskAllow: Category[] = []): Decision {
  const tierAsks = new Set(confirmRisks(tier, risks));
  const ask: Risk[] = [];
  const autoAllowed: Risk[] = [];
  const denied: Risk[] = [];
  for (const risk of risks) {
    const cat = CATEGORY_OF[risk];
    const rule = pickRule(rules, cat, repo, context);
    if (rule?.policy === "deny") denied.push(risk);
    else if (rule?.policy === "allow") autoAllowed.push(risk);
    else if (rule?.policy === "ask" || tierAsks.has(risk)) {
      if (taskAllow.includes(cat)) autoAllowed.push(risk);
      else ask.push(risk);
    }
  }
  if (denied.length) return { action: "deny", ask: [], autoAllowed, denied, reason: denied.map((r) => RISK_LABEL[r]).join(" + ") };
  if (ask.length) return { action: "ask", ask, autoAllowed, denied, reason: ask.map((r) => RISK_LABEL[r]).join(" + ") };
  return { action: "run", ask, autoAllowed, denied, reason: autoAllowed.map((r) => RISK_LABEL[r]).join(" + ") };
}

/** The repo a tool call acts on ("owner/name"), for repo-scoped rules. */
export function callRepo(call: CoderToolCall): string {
  let a: any = {};
  try {
    a = JSON.parse(call.function.arguments || "{}");
  } catch {
    /* no args */
  }
  if (typeof a.repo === "string") return normRepo(a.repo);
  const m = String(a.path || "").match(/^\/repos\/([\w.-]+\/[\w.-]+)/);
  return normRepo(m?.[1]);
}

export async function evaluateCall(
  call: CoderToolCall, gh: Parameters<typeof classifyCall>[1], tier: Tier, context: Context, rules: PrefRule[], taskAllow: Category[] = [],
): Promise<Decision & { summary: string; risks: Risk[] }> {
  const c = await classifyCall(call, gh);
  return { ...decide(c.risks, tier, callRepo(call), context, rules, taskAllow), summary: c.summary, risks: c.risks };
}

export const categoriesOf = (risks: Risk[]): Category[] => [...new Set(risks.map((r) => CATEGORY_OF[r]))];

// ---------------------------------------------------------------- storage
let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb && !(db as { ddl?: boolean }).ddl) return Promise.resolve();   // `ddl: true` = a real SQL engine in tests
  if (!ready) {
    ready = db
      .exec(`CREATE TABLE IF NOT EXISTS coder_permission_prefs (chat_key TEXT NOT NULL, category TEXT NOT NULL, repo TEXT NOT NULL DEFAULT '*', context TEXT NOT NULL DEFAULT '*', policy TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (chat_key, category, repo, context))`)
      .then(() => undefined)
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready;
}

export async function loadPrefs(chatId: number | string, db: Db = prismaDb): Promise<PrefRule[]> {
  try {
    await ensureTable(db);
    const rows = await db.query<PrefRule>(`SELECT category, repo, context, policy FROM coder_permission_prefs WHERE chat_key = $1`, coderChatKey(chatId));
    return rows.filter((r) => isCategory(r.category) && isPolicy(r.policy));
  } catch {
    return [];
  }
}

/** Sets one rule (an explicit "ask" is kept: it also makes the owner tier ask for that category). removePref = back to the tier default. */
export async function setPref(chatId: number | string, rule: PrefRule, db: Db = prismaDb): Promise<void> {
  if (!isCategory(rule.category) || !isPolicy(rule.policy)) throw new Error("bad rule");
  const repo = normRepo(rule.repo);
  const context = rule.context === "interactive" || rule.context === "scheduled" ? rule.context : "*";
  await ensureTable(db);
  await db.exec(
    `INSERT INTO coder_permission_prefs (chat_key, category, repo, context, policy, updated_at) VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (chat_key, category, repo, context) DO UPDATE SET policy = EXCLUDED.policy, updated_at = now()`,
    coderChatKey(chatId), rule.category, repo, context, rule.policy,
  );
}

export async function removePref(chatId: number | string, category: Category, repo: string, context: string, db: Db = prismaDb): Promise<void> {
  await ensureTable(db);
  await db.exec(`DELETE FROM coder_permission_prefs WHERE chat_key = $1 AND category = $2 AND repo = $3 AND context = $4`, coderChatKey(chatId), category, normRepo(repo), context === "interactive" || context === "scheduled" ? context : "*");
}

export const nextPolicy = (p: Policy | "default"): Policy | "default" => (p === "default" ? "ask" : p === "ask" ? "allow" : p === "allow" ? "deny" : "default");
/** The global rule for a category, or "default" (no rule: the tier's standing behaviour). */
export function globalPolicy(rules: PrefRule[], category: Category): Policy | "default" {
  return rules.find((r) => r.category === category && r.repo === "*" && r.context === "*")?.policy || "default";
}
/** What the tier does with no rule: "ask" or "run" (the owner tier runs settings/deploy/release/force without asking). */
export function tierDefault(tier: Tier, category: Category): "ask" | "run" {
  if (category === "edit" || category === "merge") return "run";       // opt-in categories: they ask only when the user chose "ask"
  if (tier === "user") return "ask";
  return CATEGORIES_OWNER_ASKS.has(category) ? "ask" : "run";
}
const CATEGORIES_OWNER_ASKS = new Set<Category>(["delete", "main", "external"]);
