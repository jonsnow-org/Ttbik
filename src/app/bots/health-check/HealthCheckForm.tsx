"use client";

import { useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

type BotCommand = { command: string; description: string };
type MenuButton = { type?: string; text?: string; webAppUrl?: string };
type Result = {
  bot?: {
    id?: number;
    username: string;
    firstName: string;
    botFatherName?: string;
    botFatherNameAr?: string;
    canJoinGroups: boolean;
    canReadAllGroupMessages: boolean;
    supportsInlineQueries?: boolean;
    hasMainWebApp?: boolean;
    canConnectToBusiness?: boolean;
    addedToAttachmentMenu?: boolean;
    profilePhotoCount?: number;
    commands?: BotCommand[];
    commandsAr?: BotCommand[];
    commandsPrivate?: BotCommand[];
    commandsGroups?: BotCommand[];
    commandsAdmins?: BotCommand[];
    description?: string;
    shortDescription?: string;
    descriptionAr?: string;
    shortDescriptionAr?: string;
    menuButton?: MenuButton;
    groupAdminRights?: Record<string, boolean>;
    channelAdminRights?: Record<string, boolean>;
  };
  webhook?: {
    url: string | null;
    pendingUpdateCount: number;
    lastErrorMessage: string | null;
    lastErrorDate?: string | null;
    lastSyncErrorDate?: string | null;
    port?: number | null;
    portAllowed?: boolean;
    maxConnections?: number | null;
    isHttps?: boolean;
    hostIsIp?: boolean;
    hostIsPrivate?: boolean;
    tokenEmbeddedInUrl?: boolean;
    hasCustomCertificate?: boolean;
    host?: string | null;
    ipAddress?: string | null;
    allowedUpdates?: string[];
  };
  error?: string;
};

function rightsTrue(rights?: Record<string, boolean>): string[] {
  if (!rights) return [];
  return Object.entries(rights)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

function namesDiffer(a?: string, b?: string): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return Boolean(x && y && x !== y);
}

function maskWebhookUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\d{6,12}:[A-Za-z0-9_-]{20,}/g, "[token]");
    return `${u.origin}${path}${u.search ? "?…" : ""}`;
  } catch {
    return url.replace(/\d{6,12}:[A-Za-z0-9_-]{20,}/g, "[token]").slice(0, 80);
  }
}
