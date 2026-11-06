// Turning a chat's task-event feed into chat bubbles for the Mini App.
//
// While a model writes, the server appends the growing TAIL of the same answer as several `text` events. Rendering one
// bubble per event split a single answer into a stack of fragments (and made the view jump as each fragment arrived).
// Merging consecutive `text` events into one assistant bubble makes the answer read as one message that grows in place.

export type ChatEvent = { id: number; kind: string; text: string };
export type ChatBubble = { id: number; role: "user" | "assistant" | "note"; text: string; kind?: string };

const NOTE_KINDS = new Set(["failed", "confirm", "segment"]);

/** The chat's bubbles: user prompts, assistant answers (streaming text merged), and the few event notes worth showing. */
export function threadBubbles(tasks: { events: ChatEvent[] }[]): ChatBubble[] {
  const out: ChatBubble[] = [];
  for (const task of tasks) {
    for (const event of task.events || []) {
      if (event.kind === "start") {
        out.push({ id: event.id, role: "user", text: event.text });
      } else if (event.kind === "text") {
        const last = out[out.length - 1];
        if (last && last.role === "assistant" && last.kind === "text") last.text += event.text;
        else out.push({ id: event.id, role: "assistant", text: event.text, kind: "text" });
      } else if (NOTE_KINDS.has(event.kind)) {
        out.push({ id: event.id, role: "note", text: event.text, kind: event.kind });
      }
    }
  }
  return out;
}
