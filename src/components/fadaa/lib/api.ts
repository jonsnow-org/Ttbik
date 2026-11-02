import { useFadaa } from "./store";
import type { Contribution, Session, User } from "./types";

type FadaaPayload = {
  ok: boolean;
  error?: string;
  botUsername?: string | null;
  user?: User;
  isOwner?: boolean;
  sessions?: Session[];
  contributions?: Contribution[];
  session?: Session;
  contribution?: Contribution;
};

type TelegramWebAppWindow = Window & {
  Telegram?: { WebApp?: { initData?: string } };
};

function context() {
  if (typeof window === "undefined") throw new Error("افتح فضاء من داخل Telegram.");
  const botId = new URLSearchParams(window.location.search).get("bot") || "";
  const initData = (window as TelegramWebAppWindow).Telegram?.WebApp?.initData || "";
  if (!botId || !initData) {
    throw new Error("افتح التطبيق المصغر من زر «فتح فضاء» داخل البوت حتى يتم التحقق من حسابك.");
  }
  return { botId, initData };
}

async function request(url: string, initData: string, init?: RequestInit): Promise<FadaaPayload> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-telegram-init-data": initData,
      ...(init?.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as FadaaPayload;
  if (!response.ok) throw new Error(payload.error || "تعذّر الاتصال بفضاء.");
  return payload;
}

export function applyFadaaSnapshot(payload: FadaaPayload) {
  if (!payload.user || !Array.isArray(payload.sessions) || !Array.isArray(payload.contributions)) {
    throw new Error("استجابة فضاء غير مكتملة.");
  }
  useFadaa.setState({
    user: payload.user,
    sessions: payload.sessions,
    contributions: payload.contributions,
    // Server-side actions still enforce ownership; this flag only controls navigation visibility.
    supervisor: Boolean(payload.isOwner),
  });
}

export async function refreshFadaaSnapshot() {
  const { botId, initData } = context();
  const requestedSessionId = new URLSearchParams(window.location.search).get("session");
  const sessionQuery = requestedSessionId ? `&session=${encodeURIComponent(requestedSessionId)}` : "";
  const payload = await request(`/api/fadaa?bot=${encodeURIComponent(botId)}&status=all${sessionQuery}`, initData);
  applyFadaaSnapshot(payload);
  return payload;
}

export async function fadaaAction(action: string, data: Record<string, unknown> = {}) {
  const { botId, initData } = context();
  return request(`/api/fadaa?bot=${encodeURIComponent(botId)}`, initData, {
    method: "POST",
    body: JSON.stringify({ action, botId, ...data }),
  });
}


export async function getFadaaInviteLink(sessionId: string) {
  const { botId, initData } = context();
  const payload = await request(
    `/api/fadaa?bot=${encodeURIComponent(botId)}&meta=1`,
    initData,
  );
  if (!payload.botUsername) {
    throw new Error('تعذّر الحصول على رابط البوت. أعد المحاولة لاحقاً.');
  }
  return `https://t.me/${payload.botUsername}?start=join_${encodeURIComponent(sessionId)}`;
}


export async function getFadaaBotLink() {
  const { botId, initData } = context();
  const payload = await request(
    `/api/fadaa?bot=${encodeURIComponent(botId)}&meta=1`,
    initData,
  );
  if (!payload.botUsername) {
    throw new Error('تعذّر الحصول على رابط البوت. أعد المحاولة لاحقاً.');
  }
  return `https://t.me/${payload.botUsername}`;
}
