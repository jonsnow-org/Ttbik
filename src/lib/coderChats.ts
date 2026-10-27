// Mini App control plane for the CHAT LISTS (one per model) and for carrying a conversation when the user switches model mid-work.
//
// Each model has its own list: Nova's lives in coder_threads (coderThreads.ts), Sham's and Sham v2's in sham_threads (shamThreads.ts). This file is
// the only place that knows both (like coderApp.ts), so the two models stay independent of each other: a model switch moves a NEUTRAL transcript
// (plain user/assistant text), never a module reference. Connectors are the user's, not the model's (coder_connections), so they follow automatically;
// what a switch has to carry is the conversation.
import type { Db } from "@/lib/coderAuth";
import type { ChatState } from "@/lib/coderSections";
import * as N from "@/lib/coderThreads";
import * as S from "@/lib/shamThreads";

export type ChatModelId = "coder" | "sham" | "sham_v2";
export const isChatModel = (x: unknown): x is ChatModelId => x === "coder" || x === "sham" || x === "sham_v2";
export const variantOf = (m: ChatModelId): S.ShamVariantId => (m === "sham_v2" ? "v2" : "v1");
export type ChatItem = { id: string; title: string; pinned: boolean; archived: boolean; turns: number; updated_at: string; preview: string; current: boolean };
export type Transcript = { role: "user" | "assistant"; text: string }[];
type Sdb = Parameters<typeof S.listThreads>[3];

const sdb = (db: Db): Sdb => db as unknown as Sdb;
const clip = (s: string, n: number) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

/** The chat page of one model: pinned first, then newest; `q` searches titles and what was said; archived ones are hidden unless asked for. */
export async function chatList(chatId: number, st: ChatState, model: ChatModelId, o: { q?: string; archived?: "exclude" | "only" | "include"; limit?: number }, db: Db): Promise<{ items: ChatItem[]; current: string | null; currentEmpty: boolean }> {
  if (model === "coder") {
    const rows = await N.listThreads(chatId, { q: o.q, archived: o.archived, limit: o.limit || 60 }, db);
    const items = rows.map((r) => ({ id: r.id, title: r.title, pinned: Boolean(r.pinned), archived: Boolean(r.archived), turns: Math.ceil((r.messages_count || 0) / 2), updated_at: r.updated_at, preview: "", current: r.id === st.threadId }));
    return { items, current: st.threadId || null, currentEmpty: !st.messages.length };
  }
  const v = variantOf(model);
  const cur = await S.currentThreadId(chatId, v, sdb(db));
  const rows = await S.listThreads(chatId, v, { q: o.q, archived: o.archived, limit: o.limit || 60 }, sdb(db));
  return { items: rows.map((r) => ({ id: r.id, title: r.title, pinned: r.pinned, archived: r.archived, turns: r.turns, updated_at: r.updated_at, preview: r.preview, current: r.id === cur })), current: cur, currentEmpty: !rows.find((r) => r.id === cur)?.turns };
}

export async function chatNew(chatId: number, st: ChatState, model: ChatModelId, db: Db): Promise<string> {
  if (model === "coder") return (await import("@/lib/coderSections")).switchThread(chatId, st, null, db);
  return S.newThread(chatId, variantOf(model), sdb(db));
}
/** Reopens a chat with its full history so the next message carries on from it. False when it is not this user's chat of this model. */
export async function chatOpen(chatId: number, st: ChatState, model: ChatModelId, id: string, db: Db): Promise<boolean> {
  if (model === "coder") {
    try { await (await import("@/lib/coderSections")).switchThread(chatId, st, id, db); return true; } catch { return false; }
  }
  return S.openThread(chatId, variantOf(model), id, sdb(db));
}
export async function chatRename(chatId: number, model: ChatModelId, id: string, title: string, db: Db): Promise<boolean> {
  return model === "coder" ? N.renameThread(chatId, id, title, db) : S.renameThread(chatId, variantOf(model), id, title, sdb(db));
}
export async function chatPin(chatId: number, model: ChatModelId, id: string, pinned: boolean, db: Db): Promise<boolean> {
  return model === "coder" ? N.pinThread(chatId, id, pinned, db) : S.pinThread(chatId, variantOf(model), id, pinned, sdb(db));
}
export async function chatArchive(chatId: number, st: ChatState, model: ChatModelId, id: string, archived: boolean, db: Db): Promise<boolean> {
  void st;
  return model === "coder" ? N.archiveThread(chatId, id, archived, db) : S.archiveThread(chatId, variantOf(model), id, archived, sdb(db));
}
export type DeleteSpec = { ids?: string[]; olderThanDays?: number; archived?: boolean; all?: boolean };
/** One, several, the old ones, the archived ("finished") ones or all (pinned and the open one are spared by the sweeping modes). Returns the deleted ids. */
export async function chatDelete(chatId: number, st: ChatState, model: ChatModelId, spec: DeleteSpec, db: Db): Promise<string[]> {
  if (model === "coder") {
    if (spec.ids?.includes(st.threadId || "\0")) await (await import("@/lib/coderSections")).switchThread(chatId, st, null, db);     // deleting the open chat opens a fresh one
    return N.hideThreads(chatId, { ...spec, keepId: st.threadId }, db);
  }
  return S.deleteThreads(chatId, variantOf(model), spec, sdb(db));
}
export async function chatMessages(chatId: number, model: ChatModelId, id: string, db: Db): Promise<{ role: "user" | "assistant"; text: string; at?: string }[] | null> {
  if (model === "coder") return N.threadTranscript(chatId, id, 200, db);
  const turns = await S.threadMessages(chatId, variantOf(model), id, 200, sdb(db));
  if (!turns) return null;
  const out: { role: "user" | "assistant"; text: string; at?: string }[] = [];
  for (const t of turns) { out.push({ role: "user", text: t.q, at: t.at }); if (t.a && t.a !== "…") out.push({ role: "assistant", text: t.a, at: t.at }); }
  return out;
}

// ---------------------------------------------------------------- model switch: the new model reads the conversation so far and carries on
const textOf = (m: { role: string; content?: unknown }) => (typeof m.content === "string" ? m.content : "");
/** What was said in the open conversation of a model, as neutral text. */
export async function openTranscript(chatId: number, st: ChatState, model: ChatModelId, db: Db): Promise<Transcript> {
  if (model === "coder") {
    const out: Transcript = [];
    for (const m of st.messages || []) {
      const t = textOf(m as { role: string; content?: unknown }).trim();
      if ((m.role === "user" || m.role === "assistant") && t && !t.startsWith("[harness]")) out.push({ role: m.role, text: t.slice(0, 4000) });
    }
    return out.slice(-40);
  }
  const cur = await S.currentThreadId(chatId, variantOf(model), sdb(db));
  return cur ? S.exportTranscript(chatId, variantOf(model), 40, sdb(db)) : [];
}

/** The user moved from `from` to `to` in the middle of a conversation: `to` gets the same conversation as its open chat (its history, then the new
 *  messages). Nothing is lost on the model left (its chat stays in its own list). Returns how many messages were carried. A switch back with nothing new said
 *  in between carries nothing (no copy of a copy). Call after the model has been chosen (st.model is already `to`). */
export async function carryConversation(chatId: number, st: ChatState, from: ChatModelId, to: ChatModelId, db: Db): Promise<number> {
  if (from === to) return 0;
  const transcript = await openTranscript(chatId, st, from, db);
  if (!transcript.length) return 0;
  const title = clip(transcript.find((t) => t.role === "user")?.text || "", 60);
  if (from !== "coder" && st.carry && st.carry.model === from) {
    const cur = await S.currentThreadId(chatId, variantOf(from), sdb(db));
    const row = cur === st.carry.thread ? (await S.listThreads(chatId, variantOf(from), { archived: "include" }, sdb(db))).find((r) => r.id === cur) : undefined;
    if (row && row.turns === st.carry.turns) return 0;          // that chat only holds what it was handed: nothing new to take back
  }
  if (to === "coder") {
    const id = await N.createThread(chatId, { title, messages: transcript.map((t) => ({ role: t.role, content: t.text }) as never) }, db);
    await (await import("@/lib/coderSections")).switchThread(chatId, st, id, db);
    st.carry = undefined;
  } else {
    const r = await S.importTranscript(chatId, variantOf(to), transcript, title, sdb(db));
    st.carry = { model: to, thread: r.id, turns: r.turns };
  }
  return transcript.length;
}
