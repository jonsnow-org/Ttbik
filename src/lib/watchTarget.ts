// Shared click-through and timer helpers for the AD_BOT outbound-visit flow.
export const UNOPENED_CLICK_AT = new Date("9999-12-31T23:59:59.999Z");

type TimedClick = { issuedAt: Date | string; verified: boolean } | null | undefined;

export function isUnopenedClick(click: TimedClick): boolean {
  if (!click) return false;
  return new Date(click.issuedAt).getTime() >= Date.parse("9999-12-31T23:59:59.000Z");
}

/** A task is ready only after a recorded click-through and the server timer. */
export function isTimedClickReady(click: TimedClick, now = Date.now(), requiredSeconds = 15): boolean {
  if (!click?.verified) return false;
  if (isUnopenedClick(click)) return true; // own platform bot consumed adv_<id>
  const at = new Date(click.issuedAt).getTime();
  return Number.isFinite(at) && at <= now && now - at >= requiredSeconds * 1000;
}

export function timedClickStatus(click: TimedClick, now = Date.now(), requiredSeconds = 15) {
  if (!click || !click.verified) return { started: false, remainingSeconds: requiredSeconds };
  if (isUnopenedClick(click)) return { started: true, remainingSeconds: 0 };
  const at = new Date(click.issuedAt).getTime();
  if (!Number.isFinite(at) || at > now) return { started: false, remainingSeconds: requiredSeconds };
  return { started: true, remainingSeconds: Math.max(0, Math.ceil((requiredSeconds * 1000 - (now - at)) / 1000)) };
}

// Shared by the /watch/[token] server page and the outbound-click POST route.
export function normalizeTargetUrl(type: string, content: string, clickId?: string): string {
  const raw = content.trim();
  if (type === "TELEGRAM") {
    const handle = raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/^(t\.me|telegram\.me)\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/)[0];
    const payload = clickId ? `?start=adv_${encodeURIComponent(clickId)}` : "";
    return `https://t.me/${handle}${payload}`;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw.replace(/^@/, "");
  switch (type) {
    case "TWITTER":
      return `https://x.com/${handle}`;
    case "INSTAGRAM":
      return `https://instagram.com/${handle}`;
    case "TIKTOK":
      return `https://tiktok.com/@${handle}`;
    case "FACEBOOK":
      return `https://facebook.com/${handle}`;
    case "YOUTUBE":
      return `https://youtube.com/${handle}`;
    default:
      return `https://${raw}`;
  }
}
