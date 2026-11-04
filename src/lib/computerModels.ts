/** Models whose sessions are supported by the dedicated computer hub. Keep this list in sync with server-side session routing. */
export const COMPUTER_MODEL_OPTIONS = [
  { id: "coder", label: "Nova AI" },
  { id: "lfm25", label: "LFM2.5" },
  { id: "sham", label: "Sham (old)" },
  { id: "sham_v2", label: "Sham v2" },
  { id: "qwen35-9b", label: "Qwen3.5" },
  { id: "gemma4-e4b", label: "Gemma 4" },
  { id: "minicpmo45", label: "MiniCPM-o" },
] as const;

export const COMPUTER_MODEL_IDS = COMPUTER_MODEL_OPTIONS.map(({ id }) => id);
