// Everything the app needs to find the contracts. The addresses are DERIVED (not typed in):
// collection = f(admin wallet, collection URL, notice period), minter = f(collection, admin, season range).
import { Address } from "@ton/core";

// the public places where people can find Athar (they go into the collection metadata that markets read, and into link previews)
export const BOT_URL = process.env.NEXT_PUBLIC_ATHAR_BOT_URL || "https://t.me/AtharDaysBot";
export const NETWORK = process.env.NEXT_PUBLIC_TON_NETWORK === "testnet" ? "testnet" : "mainnet";
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
// Public address of the management wallet. Read at run time on the server (ATHAR_ADMIN), so setting it needs only a restart.
// The panel can also fix it once, from the connected wallet (write-once file in the data folder), so the owner never has to hand an address over.
function adminFromFile(): string {
  if (typeof window !== "undefined") return "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs"), path = require("path");
    return String(fs.readFileSync(path.join(process.env.ATHAR_DATA_DIR || path.join(process.cwd(), "data"), "admin.txt"), "utf8")).trim();
  } catch { return ""; }
}
export const getAdmin = (): string => process.env.ATHAR_ADMIN || process.env.NEXT_PUBLIC_ATHAR_ADMIN || adminFromFile();
export const DELAY_SEC = Number(process.env.NEXT_PUBLIC_ATHAR_DELAY_SEC || 172800);   // 48h public notice period
export const TONCENTER_RPC = NETWORK === "testnet" ? "https://testnet.toncenter.com/api/v2/jsonRPC" : "https://toncenter.com/api/v2/jsonRPC";
export const TONCENTER_V3 = NETWORK === "testnet" ? "https://testnet.toncenter.com/api/v3" : "https://toncenter.com/api/v3";
// Where the token metadata and pictures are asked for (the address written into the contract, so it is chosen once, at launch).
// Default: our own server. Better: the Vercel mirror (https://<vercel host>/api/athar), which asks our server first and answers by
// itself when the server does not, so tokens keep their pictures even if the server is gone, with no contract change needed.
export const META_BASE = (process.env.NEXT_PUBLIC_ATHAR_META_BASE || (SITE_URL ? `${SITE_URL}/api` : "")).replace(/\/$/, "");
export const COLLECTION_URI = `${META_BASE}/collection`;
// The standalone living viewer (one HTML file stored permanently, rebuilt only by ../scripts/build-viewer.sh + store-viewer.ts):
// it draws a token's moving picture from the token's own numbers, so it works even if every server of ours is gone.
export const VIEWER_ID = "lnBWwZqhLeNz6W0scoF18YreB6JUMBJe38ohSXp_Fjw";
export const viewerUrl = (p: { i: number; t: number; s: number; g: number; h: number; e: number; o: number }) =>
  `https://turbo-gateway.com/${VIEWER_ID}#i=${p.i}&t=${p.t}&s=${p.s}&g=${p.g}&h=${p.h}&e=${p.e}&o=${p.o}`;
export const BASE_URI = `${META_BASE}/m/`;

export function adminAddress(): Address | null {
  try { const a = getAdmin(); return a ? Address.parse(a) : null; } catch { return null; }
}
