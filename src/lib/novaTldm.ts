/**
 * Nova's own T-LDM path — Nova 1 (`coder`) and Nova 2 (`nova2`) each with their own head, session and switch.
 *
 * This module is Nova's counterpart of Sham Pro's `generate_tldm` call in `shamStudio.ts`. It deliberately imports
 * NOTHING from Sham (no shamStudio, no shamReplyGuard, no tldmPolicy-as-Sham): the two models stay independent, and
 * `novaShamBoundary` guards that. What it shares with Sham is the *technique* (a T-LDM head served by the Studio's
 * `generate_tldm` endpoint, an isolated workspace session, an owner deny-list, and no silent fallback), not the code.
 *
 * Independence rules enforced here:
 *  - the engine model is read from the async-local set by `withEngineModel` (the same one `coderCall` uses), so a
 *    Nova 1 call can never be routed to Nova 2's Studio or head, and vice versa;
 *  - a T-LDM call never falls back: if the head is missing or the Studio is down, the caller gets an honest error
 *    (`reason: "no-fallback"`), never a silent switch to the other Nova or to Sham;
 *  - the workspace session key carries the model id (`tldm-coder-<chat>` / `tldm-nova2-<chat>`), so the two models
 *    never share a working directory even on the same computer.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { coderCall, isEngineModel, type CoderReply, type CoderToolCall } from "@/lib/openCoderStudio";
import { tldmOwnerDenyList } from "@/lib/tldmPolicy";

/** The two Nova models that can carry a T-LDM head. Nova 1 = engine id `coder`; Nova 2 = engine id `nova2`. */
export const NOVA_TLDM_MODELS = ["coder", "nova2"] as const;
export type NovaTldmModel = (typeof NOVA_TLDM_MODELS)[number];
export const isNovaTldmModel = (m: string | undefined): m is NovaTldmModel => m === "coder" || m === "nova2";

/** Per-call T-LDM switch, like Sham's `shamTldmCtx` but scoped to one Nova model. Never set for the other Nova or for Sham. */
export const novaTldmCtx = new AsyncLocalStorage<{ model: NovaTldmModel }>();

/** The model whose T-LDM path this call belongs to. Only the async-local context names it: there is no default, because
 *  defaulting to Nova 1 would be a silent fallback (the one thing the owner forbids). The caller (the bot route) sets it
 *  with `withNovaTldmModel` only after the audience gate has passed for that same model. */
export function novaTldmModel(): NovaTldmModel | null {
  const fromCtx = novaTldmCtx.getStore()?.model;
  return isNovaTldmModel(fromCtx) ? fromCtx : null;
}

/** Is the T-LDM path on for THIS call? Off unless the caller set the context (the bot route does, after the audience gate). */
export function novaTldmOn(): boolean {
  return novaTldmCtx.getStore() !== undefined;
}

/** A workspace key on the model's own computer, per chat and per model. Nova 1 and Nova 2 never share a folder. */
export function novaTldmSessionId(chatId?: number | string | null, model: NovaTldmModel | null = novaTldmModel()): string {
  const m = model || "coder";
  const c = chatId === undefined || chatId === null ? "" : String(chatId).trim();
  return c ? `tldm-${m}-${c}` : `tldm-${m}-default`;
}

/** The honest line a failed T-LDM call shows: names the model that failed and says plainly nothing else was used. */
export function novaTldmNoFallback(model: NovaTldmModel): string {
  const name = model === "nova2" ? "Nova 2" : "Nova 1";
  return `مسار T-LDM لـ${name} غير متاح الآن (الرأس أو الاستوديو). لم يُستخدم نموذج آخر بدلًا منه.`;
}

export type NovaTldmReply = CoderReply & { tldmModel?: NovaTldmModel };

/** The T-LDM `messages` shape the Studio endpoint expects. Kept local so Nova does not import Sham's types. */
export type NovaTldmMessage = { role: "user" | "assistant"; content: string };

/**
 * One T-LDM turn on the caller's Nova model. `messages` must end with a user turn. Returns an honest `error` reply
 * (never null-and-silent, never a different model) when the head is missing or the Studio is down.
 *
 * `opts.owner` skips the deny-list (the owner's own commands are not restricted by his list); for everyone else the
 * OWNER DENY-LIST OF THAT MODEL is sent, so a user's command can never exceed it.
 */
export async function novaGenerateTldm(
  messages: NovaTldmMessage[],
  session = "",
  timeoutMs = 180000,
  opts: {
    owner?: boolean;
    resume?: { command: string; approved: boolean };
    resumeTool?: { requestId: string; name: string; arguments: Record<string, unknown>; result: string; error?: boolean };
  } = {},
): Promise<NovaTldmReply> {
  const model = novaTldmModel();
  if (!model) {
    // No Nova model in scope: refuse. Never guess another model, never fall back to Sham.
    return { type: "error", text: "T-LDM requires a Nova model in scope. Nothing else was used.", error: "no-model", reason: "no-fallback" } as NovaTldmReply;
  }
  const valid = messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  if (!valid.length || valid[valid.length - 1].role !== "user") {
    return { type: "error", text: "generate_tldm requires a final user turn", error: "bad-messages", reason: "no-fallback" } as NovaTldmReply;
  }
  const sid = session || novaTldmSessionId();
  const payload: Record<string, unknown> = {
    messages_json: JSON.stringify(valid.slice(-12)),
    session: sid,
    max_new_tokens: 512,
    tldm_flag: 1,
  };
  if (opts.owner) payload.owner = 1;
  else {
    const deny = tldmOwnerDenyList(model);
    if (deny.length) payload.deny_list = deny.join("\n");
  }
  if (opts.resume?.command) {
    payload.confirm_cmd = opts.resume.command;
    payload.confirm_ok = opts.resume.approved ? 1 : 0;
  }
  if (opts.resumeTool) {
    payload.resume_tool_name = opts.resumeTool.name;
    payload.resume_tool_arguments_json = JSON.stringify(opts.resumeTool.arguments || {});
    payload.resume_tool_result = String(opts.resumeTool.result || "").slice(0, 8000);
    payload.resume_tool_error = opts.resumeTool.error ? 1 : 0;
    payload.resume_tool_request_id = opts.resumeTool.requestId;
  }
  // The engine model in scope is `model` (novaTldmModel read it from the same async-local), so coderCall routes to
  // THIS model's Studio pool only. A wrong-model Studio cannot answer it.
  const out = await coderCall("generate_tldm", payload, timeoutMs, sid);
  if (!out.reply) {
    return { type: "error", text: novaTldmNoFallback(model), error: out.failure || "no-reply", reason: "no-fallback" } as NovaTldmReply;
  }
  return { ...out.reply, tldmModel: model } as NovaTldmReply;
}

/** Run `fn` with `model` as the Nova T-LDM model for the duration (mirrors `withEngineModel`, and asserts they agree). */
export function withNovaTldmModel<T>(model: NovaTldmModel, fn: () => T): T {
  return novaTldmCtx.run({ model }, fn);
}

/** The tool call a T-LDM reply may carry back to the caller (same shape as the rest of Nova's tools). */
export type NovaTldmToolCall = CoderToolCall;

/** Guard: a model id that is a Nova T-LDM model AND an engine model (they must agree; a mismatch is a bug, not a fallback). */
export function novaTldmModelOk(model: string | undefined): model is NovaTldmModel {
  return isNovaTldmModel(model) && isEngineModel(model);
}
