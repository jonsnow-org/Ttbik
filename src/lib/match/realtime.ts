/**
 * Optional Supabase Realtime "doorbell" for the Mini App anon chat.
 *
 * Privacy design: NO message content and NO user ids ever go through
 * Realtime. The server only broadcasts an empty `ping` on a per-session topic
 * whose name contains a random 128-bit token issued by the server to the two
 * participants (stored in match_anon_rt). A client that hears the ping just
 * polls the authenticated API, which still enforces initData + participation.
 * Someone who somehow learned a topic can only learn "a message happened".
 * Uses the PUBLIC anon key only; no RLS changes, no DB migration.
 */
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { ensureMatchAppTables } from "@/lib/match/appStore";

export function realtimeConfig(): { url: string; anonKey: string } | null {
  if (process.env.MATCH_REALTIME === "off") return null;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  return url && anonKey ? { url, anonKey } : null;
}

export async function anonSessionTopic(sessionId: string): Promise<string | null> {
  if (!realtimeConfig()) return null;
  try {
    await ensureMatchAppTables();
    const token = randomBytes(16).toString("hex");
    const r = await prisma.$queryRaw<{ token: string }[]>`
      INSERT INTO match_anon_rt (session_id, token) VALUES (${sessionId}, ${token})
      ON CONFLICT (session_id) DO UPDATE SET session_id = EXCLUDED.session_id RETURNING token`;
    return `ma-${r[0].token}`;
  } catch {
    return null;
  }
}

/** Fire the doorbell (best effort, ≤1.5s, never throws). */
export async function pingAnonSession(sessionId: string): Promise<void> {
  const cfg = realtimeConfig();
  if (!cfg) return;
  try {
    await ensureMatchAppTables();
    const r = await prisma.$queryRaw<{ token: string }[]>`SELECT token FROM match_anon_rt WHERE session_id = ${sessionId}`;
    if (!r[0]) return; // no app participant subscribed → nothing to ring
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    await fetch(`${cfg.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` },
      body: JSON.stringify({ messages: [{ topic: `ma-${r[0].token}`, event: "ping", payload: {} }] }),
      signal: ac.signal,
    }).catch(() => null);
    clearTimeout(t);
  } catch { /* polling fallback covers it */ }
}
