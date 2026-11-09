"use client";
// The coder's Telegram Mini App (Nova, Sham, Sham v2): ONE interface, ./_nova/NovaApp.tsx (live tasks with streaming steps, chats of every model, schedules, memory, connectors,
// model settings, billing, the owner's panel). Every API call carries the signed initData, validated on the server (src/lib/tmaInitData.ts); what a user may see is decided by the server
// from the verified Telegram id. 2026-11-09 (owner: tidy the Mini App): the telegram-ui "native" screens (?ui=native), the "classic" screens (?ui=classic) and an unused
// "legacy" copy were three more interfaces to the same server, reachable from nowhere; they were removed (about 2,900 lines). The old links still open this interface.
import { useEffect, useState } from "react";
import NovaApp from "./_nova/NovaApp";

export default function CoderApp() {
  // Telegram Mini Apps cannot be rendered on the server (the launch data lives in the client): render after mount, like the official template
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <div style={{ minHeight: "100vh", background: "var(--tg-theme-secondary-bg-color, #f3f5f9)" }} />;
  return <NovaApp />;
}
