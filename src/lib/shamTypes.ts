// Sham's own message / tool-call shapes (the OpenAI-style structure its text protocol is built on). Defined here, structurally the same as Nova's, so
// Sham needs nothing from Nova's engine (a boundary test keeps it that way).
export type ShamToolCall = { id?: string; type?: "function"; function: { name: string; arguments: string } };
export type ShamMessage =
  | { role: "system" | "user"; content: string; ctx?: string; images?: string[] }
  | { role: "assistant"; content: string; tool_calls?: ShamToolCall[] }
  | { role: "tool"; content: string; tool_call_id?: string; name?: string };
export type ShamTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
