// The Mini App's per-model binding (owner 2026-11-18): "every model is independent; when the user switches model, every function is bound
// to THAT model and shown in its real place". One pure table, used by the app (src/app/coder-app/_nova) and asserted by the tests, so a
// screen can never quietly talk to another model's chats, computer, memory or settings.
import { computerHomeOf, computerModelOf, computerSessionOf, type ComputerHome } from "@/lib/computerModels";

export type ModelFamily = "nova" | "sham";
export type MiniAppBinding = {
  /** The model every request of this screen names (canonical id). */
  model: string;
  family: ModelFamily;
  /** Chat list / chat ops (`chats`, `chat_*`) carry this model. */
  chatsModel: string;
  /** Nova's own chats open in the rich thread page (live run, steps); every other model opens its own chat page. */
  threadPage: boolean;
  /** The computer of this model: which model id the `box` / `desktop` ops name, where it lives, and its private session. */
  computer: { model: string; home: ComputerHome };
  /** Long-term memory: Nova family keeps it in `memories` (its own store), the Shams in `sham_memory`. */
  memory: "memories" | "sham_memory";
  /** Scheduled tasks run on the Nova-family engines only. */
  schedules: boolean;
  /** The T-LDM switch belongs to Sham Pro (sham_v2) only. */
  tldm: boolean;
};

/** The canonical model id of a settings value ("sham_loop" is the old Sham; nothing means Nova). */
export const canonicalModel = (id: string | undefined | null): string => (id === "sham_loop" ? "sham" : id || "coder");

export function bindingFor(selected: string | undefined | null): MiniAppBinding {
  const model = canonicalModel(selected);
  const family: ModelFamily = model === "sham" || model === "sham_v2" ? "sham" : "nova";
  return {
    model,
    family,
    chatsModel: model,
    threadPage: model === "coder",
    computer: { model: computerModelOf(model), home: computerHomeOf(model) },
    memory: family === "sham" ? "sham_memory" : "memories",
    schedules: family === "nova",
    tldm: model === "sham_v2",
  };
}

/** The private computer session of a user on the selected model (what the server builds from the verified id). */
export const computerSessionFor = (userId: number | string, selected: string | undefined | null): string => computerSessionOf(userId, bindingFor(selected).computer.model);

/** Ops whose body must name the bound model; the app adds `model` to each of them so the server never falls back to another model. */
export const MODEL_SCOPED_OPS = ["chats", "chat_new", "chat_open", "chat_rename", "chat_pin", "chat_archive", "chat_delete", "chat_messages", "threads", "tasks", "stop_all", "memories", "memory_add", "memory_update", "memory_delete", "sham_memory", "box", "desktop"] as const;
const SCOPED = new Set<string>(MODEL_SCOPED_OPS);

/** The body of one app request bound to the selected model (an explicit `model` already in the body is replaced: no cross-model calls). */
export function boundBody(op: string, selected: string | undefined | null, body: Record<string, unknown> = {}): Record<string, unknown> {
  if (!SCOPED.has(op)) return body;
  const b = bindingFor(selected);
  const model = op === "box" || op === "desktop" ? b.computer.model : b.chatsModel;
  return { ...body, model };
}
