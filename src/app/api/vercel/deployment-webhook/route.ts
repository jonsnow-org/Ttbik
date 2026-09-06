import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// Vercel Webhooks receiver — real-time alert the moment a PRODUCTION
// deployment fails, sent straight to the owner's Telegram (reuses the same
// TELEGRAM_BOT_TOKEN/TELEGRAM_ADMIN_CHAT_ID pair already used for order
// alerts) instead of only existing in Vercel's own dashboard/email, which
// the owner has no routine reason to check. Real incident (2026-09-06): a
// broken build sat unnoticed on production for hours while every Telegram
// bot silently failed for real users, with the only signal being a Vercel
// email the owner happened to see much later.
//
// One-time setup in Vercel: Account/Team Settings → Webhooks → Create
// Webhook → URL: https://<your-domain>/api/vercel/deployment-webhook →
// Events: check "deployment.error" → Scope: this project only → Save.
// Vercel then shows a signing secret ONE TIME — set it as
// VERCEL_WEBHOOK_SECRET here and redeploy once for it to take effect.
// Signature: HMAC-SHA1 over the raw request body, hex-encoded, delivered
// in the x-vercel-signature header (per Vercel's own webhook docs).
function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.VERCEL_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const givenBuf = Buffer.from(signature);
  return expectedBuf.length === givenBuf.length && crypto.timingSafeEqual(expectedBuf, givenBuf);
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-vercel-signature");
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  if (event?.type === "deployment.error") {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (token && chatId) {
      const payload = event.payload || {};
      const projectName = payload.project?.name || payload.name || "ttbik";
      const meta = payload.deployment?.meta || payload.meta || {};
      const commitMessage = meta.githubCommitMessage || meta.gitCommitMessage || "";
      const url = payload.deployment?.url || payload.url;
      const inspectorUrl = payload.links?.deployment || (url ? `https://${url}` : "");
      const text = [
        `🚨 فشل نشر (Deployment) على Vercel — مشروع ${projectName}`,
        commitMessage ? `التغيير: ${commitMessage}` : null,
        inspectorUrl || null,
        "⚠️ الموقع والبوتات قد تستمر بتشغيل النسخة السابقة الناجحة، لكن أي إصلاح جديد لن يصل حتى تُحل مشكلة البناء.",
      ]
        .filter(Boolean)
        .join("\n");
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      }).catch(() => null);
    }
  }

  return NextResponse.json({ ok: true });
}
