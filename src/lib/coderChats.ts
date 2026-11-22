// Mini App control plane for independent per-model chat lists. Model switching changes routing only;
// each transcript remains in its own model store and is never copied into another model.
// Connectors are account-level and stay available to every permitted model.
import type { Db } from "@/lib/coderAuth";
import type { ChatState } from "@/lib/coderSections";
import * as N from "@/lib/coderThreads";
import * as S from "@/lib/shamThreads";
import { withEngineModel } from "@/lib/openCoderStudio";

export type ChatModelId = "coder" | "nova2" | "sham" | "sham_v2";
export const isChatModel = (x: unknown): x is ChatModelId => x === "coder" || x === "nova2" || x === "sham" || x === "sham_v2";
/** Nova 2 keeps its threads under their own private chat id (same rule as coderSections.modelSessionChatId); Nova keeps the historical id. */
type PrivateChatModel = "nova2";
const isPrivate = (m: ChatModelId): m is PrivateChatModel => m === "nova2";
export const modelChatId = (chatId: number, model: ChatModelId): number | string => isPrivate(model) ? `${chatId}#model:${model}` : chatId;
export const variantOf = (m: ChatModelId): S.ShamVariantId => (m === "sham_v2" ? "v2" : "v1");
export type ChatItem = { id: string; title: string; pinned: boolean; archived: boolean; turns: number; updated_at: string; preview: string; current: boolean };
type Sdb = Parameters<typeof S.listThreads>[3];

const sdb = (db: Db): Sdb => db as unknown as Sdb;

/** The Sham chat (thread) this user currently has open for `model`, or null. Used to tag a run so the Mini App can stream it live.
 *  Lives here, not in coderSections: this module is the one allowed meeting point of the Nova and Sham sides. */
export async function shamOpenThreadId(chatId: number, model: ChatModelId, db: Db): Promise<string | null> {
  if (model !== "sham" && model !== "sham_v2") return null;
  return S.currentThreadId(chatId, variantOf(model), sdb(db));
}
const clip = (s: string, n: number) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Quarantine a transcript imported by the pre-isolation model-switch code.
 * That code recorded its destination thread in ChatState.carry. Keep the old
 * data, but archive it and open a clean thread so it can never be fed to a
 * model as if it were that model's own conversation.
 */
export async function isolateLegacyCarryState(chatId: number, st: ChatState, db: Db): Promise<boolean> {
  const carry = st.carry;
  if (!carry || (carry.model !== "sham" && carry.model !== "sham_v2") || !carry.thread) return false;

  const variant: S.ShamVariantId = carry.model === "sham_v2" ? "v2" : "v1";
  const targetDb = sdb(db);
  const active = await S.currentThreadId(chatId, variant, targetDb);

  // The thread is an old cross-model import. Preserve its contents for inspection,
  // but keep it out of the normal chat list and away from the active model context.
  await S.renameThread(chatId, variant, carry.thread, "معزول: سياق قديم منقول من نموذج آخر", targetDb);
  const archived = await S.archiveThread(chatId, variant, carry.thread, true, targetDb);
  if (active === carry.thread) {
    if (!archived) throw new Error("Could not isolate the legacy cross-model transcript.");
    await S.newThread(chatId, variant, targetDb);
  }
  st.carry = undefined;
  return true;
}

/** The chat page of one model: pinned first, then newest; `q` searches titles and what was said; archived ones are hidden unless asked for. */
export async function chatList(chatId: number, st: ChatState, model: ChatModelId, o: { q?: string; archived?: "exclude" | "only" | "include"; limit?: number }, db: Db): Promise<{ items: ChatItem[]; current: string | null; currentEmpty: boolean }> {
  if ((model === "coder" || model === "nova2")) {
    const own = isPrivate(model)
      ? await withEngineModel(model, async () => {
          const C = await import("@/lib/coderSections");
          await C.ensureModelSessionState(chatId, model, db);
          return C.loadState(chatId, db);
        })
      : st;
    const rows = await N.listThreads(modelChatId(chatId, model), { q: o.q, archived: o.archived, limit: o.limit || 60 }, db);
    const items = rows.map((r) => ({ id: r.id, title: r.title, pinned: Boolean(r.pinned), archived: Boolean(r.archived), turns: Math.ceil((r.messages_count || 0) / 2), updated_at: r.updated_at, preview: "", current: r.id === own.threadId }));
    return { items, current: own.threadId || null, currentEmpty: !own.messages.length };
  }
  const v = variantOf(model);
  const cur = await S.currentThreadId(chatId, v, sdb(db));
  const rows = await S.listThreads(chatId, v, { q: o.q, archived: o.archived, limit: o.limit || 60 }, sdb(db));
  return { items: rows.map((r) => ({ id: r.id, title: r.title, pinned: r.pinned, archived: r.archived, turns: r.turns, updated_at: r.updated_at, preview: r.preview, current: r.id === cur })), current: cur, currentEmpty: !rows.find((r) => r.id === cur)?.turns };
}

export async function chatNew(chatId: number, st: ChatState, model: ChatModelId, db: Db): Promise<string> {
  if (model === "coder") return (await import("@/lib/coderSections")).switchThread(chatId, st, null, db);
  if (isPrivate(model)) return withEngineModel(model, async () => {
    const C = await import("@/lib/coderSections");
    await C.ensureModelSessionState(chatId, model, db);
    return C.switchThread(chatId, await C.loadState(chatId, db), null, db);
  });
  return S.newThread(chatId, variantOf(model), sdb(db));
}
/** Reopens a chat with its full history so the next message carries on from it. False when it is not this user's chat of this model. */
export async function chatOpen(chatId: number, st: ChatState, model: ChatModelId, id: string, db: Db): Promise<boolean> {
  if (model === "coder") {
    try { await (await import("@/lib/coderSections")).switchThread(chatId, st, id, db); return true; } catch { return false; }
  }
  if (isPrivate(model)) return withEngineModel(model, async () => {
    const C = await import("@/lib/coderSections");
    await C.ensureModelSessionState(chatId, model, db);
    try { await C.switchThread(chatId, await C.loadState(chatId, db), id, db); return true; } catch { return false; }
  });
  return S.openThread(chatId, variantOf(model), id, sdb(db));
}
export async function chatRename(chatId: number, model: ChatModelId, id: string, title: string, db: Db): Promise<boolean> {
  return (model === "coder" || model === "nova2") ? N.renameThread(modelChatId(chatId, model), id, title, db) : S.renameThread(chatId, variantOf(model), id, title, sdb(db));
}
export async function chatPin(chatId: number, model: ChatModelId, id: string, pinned: boolean, db: Db): Promise<boolean> {
  return (model === "coder" || model === "nova2") ? N.pinThread(modelChatId(chatId, model), id, pinned, db) : S.pinThread(chatId, variantOf(model), id, pinned, sdb(db));
}
export async function chatArchive(chatId: number, st: ChatState, model: ChatModelId, id: string, archived: boolean, db: Db): Promise<boolean> {
  void st;
  return (model === "coder" || model === "nova2") ? N.archiveThread(modelChatId(chatId, model), id, archived, db) : S.archiveThread(chatId, variantOf(model), id, archived, sdb(db));
}
export type DeleteSpec = { ids?: string[]; olderThanDays?: number; archived?: boolean; all?: boolean };
/** One, several, the old ones, the archived ("finished") ones or all (pinned and the open one are spared by the sweeping modes). Returns the deleted ids. */
export async function chatDelete(chatId: number, st: ChatState, model: ChatModelId, spec: DeleteSpec, db: Db): Promise<string[]> {
  if (model === "coder") {
    if (spec.ids?.includes(st.threadId || "\0")) await (await import("@/lib/coderSections")).switchThread(chatId, st, null, db);     // deleting the open chat opens a fresh one
    return N.hideThreads(chatId, { ...spec, keepId: st.threadId }, db);
  }
  if (isPrivate(model)) return withEngineModel(model, async () => {
    const C = await import("@/lib/coderSections");
    await C.ensureModelSessionState(chatId, model, db);
    const own = await C.loadState(chatId, db);
    if (spec.ids?.includes(own.threadId || "\0")) await C.switchThread(chatId, own, null, db);
    return N.hideThreads(modelChatId(chatId, model), { ...spec, keepId: own.threadId }, db);
  });
  return S.deleteThreads(chatId, variantOf(model), spec, sdb(db));
}
export async function chatMessages(chatId: number, model: ChatModelId, id: string, db: Db): Promise<{ role: "user" | "assistant"; text: string; at?: string }[] | null> {
  if ((model === "coder" || model === "nova2")) return N.threadTranscript(modelChatId(chatId, model), id, 200, db);
  const turns = await S.threadMessages(chatId, variantOf(model), id, 200, sdb(db));
  if (!turns) return null;
  const out: { role: "user" | "assistant"; text: string; at?: string }[] = [];
  for (const t of turns) { out.push({ role: "user", text: t.q, at: t.at }); if (t.a && t.a !== "…") out.push({ role: "assistant", text: t.a, at: t.at }); }
  return out;
}

type TaskLike = { slot?: string | null; thread_id?: string | null };
/**
 * Only the tasks of ONE model (owner 2026-11-18: nothing from another model shows up after a switch).
 * Sham / Sham 2 runs carry their own slot; Nova and Nova 2 runs are told apart by the thread they belong to
 * (each keeps its threads under its own chat id), and Nova also owns its scheduled runs (slot "s:<id>").
 */
export async function tasksOfModel<T extends TaskLike>(chatId: number, model: ChatModelId, tasks: T[], db: Db): Promise<T[]> {
  const slotOf = (t: T) => String(t.slot || "");
  if (model === "sham") return tasks.filter((t) => slotOf(t) === "sham" || slotOf(t) === "sham_v1");
  if (model === "sham_v2") return tasks.filter((t) => slotOf(t) === "sham_v2");
  const novaFamily = tasks.filter((t) => slotOf(t) === "" || slotOf(t).startsWith("s:") || slotOf(t) === `model:${model}`);
  const idsOf = async (m: ChatModelId) => new Set((await N.listThreads(modelChatId(chatId, m), { limit: 100, archived: "include" }, db).catch(() => [])).map((r) => r.id));
  if (model === "coder") {
    const others = new Set<string>([...(await idsOf("nova2"))]);
    return novaFamily.filter((t) => slotOf(t) !== "model:nova2" && !(t.thread_id && others.has(t.thread_id)));
  }
  const own = await idsOf(model);
  return novaFamily.filter((t) => slotOf(t) === `model:${model}` || Boolean(t.thread_id && own.has(t.thread_id)));
}
