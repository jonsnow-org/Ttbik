import { NextRequest, NextResponse } from "next/server";

// Stateless proxy to Telegram's own free Bot API (getMe + getWebhookInfo + getMyCommands
// + getMyDescription + getMyShortDescription + getMyName + getChatMenuButton
// + getMyDefaultAdministratorRights for groups and channels).
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
      descRes,
      shortDescRes,
      nameRes,
      menuRes,
      groupRightsRes,
      channelRightsRes,
    ] = await Promise.all([
      fetch(`https://api.telegram.org/bot${token}/getMe`),
      fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`),
      fetch(`https://api.telegram.org/bot${token}/getMyCommands`),
      fetch(`https://api.telegram.org/bot${token}/getMyDescription`),
      fetch(`https://api.telegram.org/bot${token}/getMyShortDescription`),
      fetch(`https://api.telegram.org/bot${token}/getMyName`),
      fetch(`https://api.telegram.org/bot${token}/getChatMenuButton`),
      fetch(`https://api.telegram.org/bot${token}/getMyDefaultAdministratorRights`),
      fetch(
        `https://api.telegram.org/bot${token}/getMyDefaultAdministratorRights?for_channels=true`,
      ),
    ]);
    const me = await meRes.json();
    const webhook = await webhookRes.json();
    const commandsJson = await commandsRes.json();
    const descJson = await descRes.json().catch(() => ({}));
    const shortDescJson = await shortDescRes.json().catch(() => ({}));
    const nameJson = await nameRes.json().catch(() => ({}));
    const menuJson = await menuRes.json().catch(() => ({}));
    const groupRightsJson = await groupRightsRes.json().catch(() => ({}));
    const channelRightsJson = await channelRightsRes.json().catch(() => ({}));

    if (!me.ok) {
      return NextResponse.json({ error: "التوكن غير صالح أو تم إلغاؤه من BotFather." }, { status: 200 });
    }

    const lastErrorDate = webhook.result?.last_error_date
      ? new Date(webhook.result.last_error_date * 1000).toISOString()
      : null;
    const lastSyncDate = webhook.result?.last_synchronization_error_date
      ? new Date(webhook.result.last_synchronization_error_date * 1000).toISOString()
      : null;

    const commands = Array.isArray(commandsJson?.result)
      ? commandsJson.result
          .filter((c: { command?: string }) => typeof c?.command === "string")
          .map((c: { command: string; description?: string }) => ({
            command: c.command,
            description: typeof c.description === "string" ? c.description : "",
          }))
      : [];

    const description =
      typeof descJson?.result?.description === "string" ? descJson.result.description : "";
    const shortDescription =
      typeof shortDescJson?.result?.short_description === "string"
        ? shortDescJson.result.short_description
        : "";
    const botFatherName =
      typeof nameJson?.result?.name === "string" ? nameJson.result.name : "";

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

    return NextResponse.json({
      ok: true,
      bot: {
        id: me.result.id,
        username: me.result.username,
        firstName: me.result.first_name,
        botFatherName,
        canJoinGroups: me.result.can_join_groups,
        canReadAllGroupMessages: me.result.can_read_all_group_messages,
        supportsInlineQueries: Boolean(me.result.supports_inline_queries),
        canConnectToBusiness: Boolean(me.result.can_connect_to_business),
        hasMainWebApp: Boolean(me.result.has_main_web_app),
        addedToAttachmentMenu: Boolean(me.result.added_to_attachment_menu),
        commands,
        description,
        shortDescription,
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
      },
    });
  } catch {
    return NextResponse.json({ error: "تعذّر الوصول لخوادم تليجرام حالياً، حاول مجدداً." }, { status: 502 });
  }
}
