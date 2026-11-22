/** Model identities supported by the Mini App computer surface. Each selected model has its own route and private session.
 *  Nova 1 uses COMPUTER_STUDIO_URL; Nova 2 requires NOVA2_COMPUTER_STUDIO_URL and stays unavailable until provisioned.
 *  Sham/Sham Pro use their own embedded computer inside their model Studio (desktopComputer.ts / computerBox.ts). */
export const COMPUTER_MODEL_OPTIONS = [
  { id: "coder", label: "Nova AI" },
  { id: "nova2", label: "Nova 2" },
  { id: "sham", label: "Sham (old)" },
  { id: "sham_v2", label: "Sham Pro" },
] as const;

export const COMPUTER_MODEL_IDS = COMPUTER_MODEL_OPTIONS.map(({ id }) => id);

/** Mini App tab routing: Nova uses the shared hub, Nova 2 uses its own configured endpoint, Shams use embedded computers. */
export type ComputerHome = "miniapp-hub" | "embedded";
export const computerHomeOf = (id: string | undefined): ComputerHome => (id === "sham" || id === "sham_v2" ? "embedded" : "miniapp-hub");

/** The computer identity of a model. Identity on purpose: no model borrows another model's computer session (Nova 2 used to map to Nova). */
export const computerModelOf = (id: string | undefined): string => id || "coder";

/** The private session key of one user on one model's computer. Distinct models never share a key. */
export const computerSessionOf = (userId: number | string, id: string | undefined): string => `${userId}:${computerModelOf(id)}`;
