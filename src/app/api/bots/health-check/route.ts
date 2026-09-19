import { NextRequest, NextResponse } from "next/server";

// Stateless proxy to Telegram's own free Bot API (getMe + getWebhookInfo + getMyCommands
// + getMyCommands?language_code=ar + getMyDescription + getMyShortDescription + getMyName
// + same three with language_code=ar + getChatMenuButton + getMyDefaultAdministratorRights
// for groups and channels + getUserProfilePhotos for BotFather avatar presence).
// — never persists the token anywhere (no DB write, no logging of the
// request body), same privacy bar as the token pasted into /bots' own
// deploy form. Real, zero-cost utility: lets anyone verify a bot token is
// alive and see its current webhook status before trusting/buying access
// to a channel or bot (owner-analysis idea, 2026-09-16: "فاحص صحة
// البوتات والقنوات").
export const dynamic = "force-dynamic";

function extractToken(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/\b(\d{6,12}:[A-Za-z0-9_-]{30,})\b/);
  return m ? m[1] : trimmed;
}

type AdminRights = Record<string, boolean | undefined>;

function pickRights(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as AdminRights;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

function parseCommands(json: unknown): { command: string; description: string }[] {
  const result = (json as { result?: unknown })?.result;
  if (!Array.isArray(result)) return [];
  return result
    .filter((c: { command?: string }) => typeof c?.command === "string")
    .map((c: { command: string; description?: string }) => ({
      command: c.command,
      description: typeof c.description === "string" ? c.description : "",
    }));
}

function pickText(json: unknown, key: "description" | "short_description" | "name"): string {
  const result = (json as { result?: Record<string, unknown> })?.result;
  const val = result?.[key];
  return typeof val === "string" ? val : "";
}

function isPrivateHost(hostRaw: string): boolean {
  const host = hostRaw.toLowerCase();
  if (!host) return false;
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? extractToken(body.token) : "";

  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) {
    return NextResponse.json({ error: "صيغة التوكن غير صحيحة." }, { status: 400 });
  }

  try {
    const [
      meRes,
      webhookRes,
      commandsRes,
      commandsArRes,
      descRes,
      shortDescRes,
      nameRes,
      descArRes,
      shortDescArRes,
      nameArRes,
      menuRes,
      groupRightsRes,
      channelRightsRes,
      commandsPrivRes,
      commandsGroupRes,
    ] = await Promise.all([
      fetch(`https://api.telegram.org/bot${token}/getMe`),
      fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`),
      fetch(`https://api.telegram.org/bot${token}/getMyCommands`),
      fetch(`https://api.telegram.org/bot${token}/getMyCommands?language_code=ar`),
      fetch(`https://api.telegram.org/bot${token}/getMyDescription`),
      fetch(`https://api.telegram.org/bot${token}/getMyShortDescription`),
      fetch(`https://api.telegram.org/bot${token}/getMyName`),
      fetch(`https://api.telegram.org/bot${token}/getMyDescription?language_code=ar`),
      fetch(`https://api.telegram.org/bot${token}/getMyShortDescription?language_code=ar`),
      fetch(`https://api.telegram.org/bot${token}/getMyName?language_code=ar`),
      fetch(`https://api.telegram.org/bot${token}/getChatMenuButton`),
      fetch(`https://api.telegram.org/bot${token}/getMyDefaultAdministratorRights`),
      fetch(
        `https://api.telegram.org/bot${token}/getMyDefaultAdministratorRights?for_channels=true`,
      ),
      fetch(
        `https://api.telegram.org/bot${token}/getMyCommands?scope=${encodeURIComponent(JSON.stringify({ type: "all_private_chats" }))}`,
      ),
      fetch(
        `https://api.telegram.org/bot${token}/getMyCommands?scope=${encodeURIComponent(JSON.stringify({ type: "all_group_chats" }))}`,
      ),
    ]);
    const me = await meRes.json();
    const webhook = await webhookRes.json();
    const commandsJson = await commandsRes.json();
    const commandsArJson = await commandsArRes.json().catch(() => ({}));
    const descJson = await descRes.json().catch(() => ({}));
    const shortDescJson = await shortDescRes.json().catch(() => ({}));
    const nameJson = await nameRes.json().catch(() => ({}));
    const descArJson = await descArRes.json().catch(() => ({}));
    const shortDescArJson = await shortDescArRes.json().catch(() => ({}));
    const nameArJson = await nameArRes.json().catch(() => ({}));
    const menuJson = await menuRes.json().catch(() => ({}));
    const groupRightsJson = await groupRightsRes.json().catch(() => ({}));
    const channelRightsJson = await channelRightsRes.json().catch(() => ({}));
    const commandsPrivJson = await commandsPrivRes.json().catch(() => ({}));
    const commandsGroupJson = await commandsGroupRes.json().catch(() => ({}));

    if (!me.ok) {
      return NextResponse.json({ error: "التوكن غير صالح أو تم إلغاؤه من BotFather." }, { status: 200 });
    }

    let profilePhotoCount = 0;
    try {
      const photosRes = await fetch(
        `https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${me.result.id}&limit=1`,
      );
      const photosJson = await photosRes.json();
      if (photosJson?.ok && typeof photosJson.result?.total_count === "number") {
        profilePhotoCount = photosJson.result.total_count;
      }
    } catch {
      profilePhotoCount = 0;
    }

    const lastErrorDate = webhook.result?.last_error_date
      ? new Date(webhook.result.last_error_date * 1000).toISOString()
      : null;
    const lastSyncDate = webhook.result?.last_synchronization_error_date
      ? new Date(webhook.result.last_synchronization_error_date * 1000).toISOString()
      : null;

    const commands = parseCommands(commandsJson);
    const commandsAr = parseCommands(commandsArJson);
    const commandsPrivate = parseCommands(commandsPrivJson);
    const commandsGroups = parseCommands(commandsGroupJson);

    const description = pickText(descJson, "description");
    const shortDescription = pickText(shortDescJson, "short_description");
    const botFatherName = pickText(nameJson, "name");
    const descriptionAr = pickText(descArJson, "description");
    const shortDescriptionAr = pickText(shortDescArJson, "short_description");
    const botFatherNameAr = pickText(nameArJson, "name");

    const menuRaw = menuJson?.ok ? menuJson.result : null;
    const menuButton = menuRaw && typeof menuRaw === "object"
      ? {
          type: typeof menuRaw.type === "string" ? menuRaw.type : "default",
          text: typeof menuRaw.text === "string" ? menuRaw.text : "",
          webAppUrl:
            typeof menuRaw.web_app?.url === "string" ? menuRaw.web_app.url : "",
        }
      : { type: "unknown", text: "", webAppUrl: "" };

    const groupAdminRights = groupRightsJson?.ok ? pickRights(groupRightsJson.result) : {};
    const channelAdminRights = channelRightsJson?.ok ? pickRights(channelRightsJson.result) : {};

    let webhookHost: string | null = null;
    let hostIsIp = false;
    let hostIsPrivate = false;
    try {
      if (webhook.result?.url) {
        const u = new URL(webhook.result.url);
        webhookHost = u.host;
        hostIsIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname) || u.hostname.includes(":");
        hostIsPrivate = isPrivateHost(u.hostname);
      }
    } catch {
      webhookHost = null;
    }

    return NextResponse.json({
      ok: true,
      bot: {
        id: me.result.id,
        username: me.result.username,
        firstName: me.result.first_name,
        botFatherName,
        botFatherNameAr,
        canJoinGroups: me.result.can_join_groups,
        canReadAllGroupMessages: me.result.can_read_all_group_messages,
        supportsInlineQueries: Boolean(me.result.supports_inline_queries),
        canConnectToBusiness: Boolean(me.result.can_connect_to_business),
        hasMainWebApp: Boolean(me.result.has_main_web_app),
        addedToAttachmentMenu: Boolean(me.result.added_to_attachment_menu),
        profilePhotoCount,
        commands,
        commandsAr,
        commandsPrivate,
        commandsGroups,
        description,
        shortDescription,
        descriptionAr,
        shortDescriptionAr,
        menuButton,
        groupAdminRights,
        channelAdminRights,
      },
      webhook: {
        url: webhook.result?.url || null,
        pendingUpdateCount: webhook.result?.pending_update_count ?? 0,
        lastErrorMessage: webhook.result?.last_error_message || null,
        lastErrorDate,
        lastSyncErrorDate: lastSyncDate,
        ipAddress: webhook.result?.ip_address || null,
        maxConnections: webhook.result?.max_connections ?? null,
        allowedUpdates: Array.isArray(webhook.result?.allowed_updates)
          ? webhook.result.allowed_updates
          : [],
        hasCustomCertificate: Boolean(webhook.result?.has_custom_certificate),
        isHttps: typeof webhook.result?.url === "string" && webhook.result.url.startsWith("https://"),
        host: webhookHost,
        tokenEmbeddedInUrl: typeof webhook.result?.url === "string" && webhook.result.url.includes(token),
        hostIsIp,
        hostIsPrivate,
      },
    });
  } catch {
    return NextResponse.json({ error: "تعذّر الوصول لخوادم تليجرام حالياً، حاول مجدداً." }, { status: 502 });
  }
}
