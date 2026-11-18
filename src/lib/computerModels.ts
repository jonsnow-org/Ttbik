/** Models whose sessions are supported by the dedicated computer hub. Keep this list in sync with server-side session routing.
 *  Every model is independent (owner 2026-11-18): each one has its OWN computer session, files, browser cookies and desktop.
 *  Nova 1 and Nova 2 both work on the Mini App computer (COMPUTER_STUDIO_URL), each in its own private session;
 *  Sham and Sham 2 work on their own internal computer inside their own Studio (see desktopComputer.ts / computerBox.ts). */
export const COMPUTER_MODEL_OPTIONS = [
  { id: "coder", label: "Nova AI" },
  { id: "nova2", label: "Nova 2" },
  { id: "lfm25", label: "LFM2.5" },
  { id: "sham", label: "Sham (old)" },
  { id: "sham_v2", label: "Sham Pro" },
] as const;

export const COMPUTER_MODEL_IDS = COMPUTER_MODEL_OPTIONS.map(({ id }) => id);

/** Where a model's computer lives: the Mini App computer hub (Nova family) or the model's own embedded computer (Sham family). */
export type ComputerHome = "miniapp-hub" | "embedded";
export const computerHomeOf = (id: string | undefined): ComputerHome => (id === "sham" || id === "sham_v2" ? "embedded" : "miniapp-hub");

/** The computer identity of a model. Identity on purpose: no model borrows another model's computer session (Nova 2 used to map to Nova). */
export const computerModelOf = (id: string | undefined): string => id || "coder";

/** The private session key of one user on one model's computer. Distinct models never share a key. */
export const computerSessionOf = (userId: number | string, id: string | undefined): string => `${userId}:${computerModelOf(id)}`;
