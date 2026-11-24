/**
 * Platform owner = the long-standing admin ids SUPER_ADMIN_TELEGRAM_ID / TELEGRAM_ADMIN_CHAT_ID
 * (server env, comma-separated allowed). Nothing else: no stored or recovered accounts.
 * The owner stays exempt from the T-LDM deny list and learning filters through this check.
 */
export function ownerIdList(): string[] {
  const out: string[] = [];
  for (const raw of [process.env.SUPER_ADMIN_TELEGRAM_ID, process.env.TELEGRAM_ADMIN_CHAT_ID]) {
    for (const p of String(raw || "").split(",")) {
      const id = p.trim();
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function isPlatformOwner(id: unknown): boolean {
  const s = String(id ?? "").trim();
  return Boolean(s) && ownerIdList().includes(s);
}

/** First configured id — for outbound notices only. */
export function primaryOwnerId(): string {
  return ownerIdList()[0] || "";
}
