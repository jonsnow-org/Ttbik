// Everything the app needs to find the contracts. The addresses are DERIVED (not typed in):
// collection = f(admin wallet, collection URL, notice period), minter = f(collection, admin, season range).
import { Address } from "@ton/core";

export const NETWORK = process.env.NEXT_PUBLIC_TON_NETWORK === "testnet" ? "testnet" : "mainnet";
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
export const ADMIN = process.env.NEXT_PUBLIC_ATHAR_ADMIN || "";            // public address of the management wallet
export const DELAY_SEC = Number(process.env.NEXT_PUBLIC_ATHAR_DELAY_SEC || 172800);   // 48h public notice period
export const TONCENTER_RPC = NETWORK === "testnet" ? "https://testnet.toncenter.com/api/v2/jsonRPC" : "https://toncenter.com/api/v2/jsonRPC";
export const TONCENTER_V3 = NETWORK === "testnet" ? "https://testnet.toncenter.com/api/v3" : "https://toncenter.com/api/v3";
export const COLLECTION_URI = `${SITE_URL}/api/collection`;
export const BASE_URI = `${SITE_URL}/api/m/`;

export function adminAddress(): Address | null {
  try { return ADMIN ? Address.parse(ADMIN) : null; } catch { return null; }
}
