import { NextRequest, NextResponse } from "next/server";
import { Bot, InputFile } from "grammy";
import { prisma } from "@/lib/prisma";
import { tierFor } from "@/lib/coderAuth";
import { verifyDonorToolTicket } from "@/lib/donorToolBridge";
import { candidateMediaStudio, photoWeightProfile } from "@/lib/photoWeightMedia";
import { taskEvent, taskIsActive, taskStatus } from "@/lib/coderTasks";
import { recordDonorAsyncDelivery } from "@/lib/coderSections";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type GeneratedImage = {
  kind?: string;
  mime?: string;
  b64?: string;
  candidate?: string;
  model_repo?: string;
  checkpoint_sha256?: string;
  metadata?: Record<string, unknown>;
  seed?: number;
  media_repo?: string;
  media_studio?: string;
  bytes?: number;
};

function chunks(value: string, max = 3500): string[] {
  const out: string[] = [];
  let rest = value.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < Math.floor(max * 0.5)) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

async function candidateBot(botId: string) {
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(botId)) return null;
  const row = await prisma.bot.findUnique({ where: { id: botId } }).catch(() => null);
  return row && row.isActive ? row : null;
}

/**
 * Candidate Studio callback: the candidate's own ModelScope worker posts its final answer
 * and optional generated image here after inference completes. The short-lived ticket binds
 * this callback to one owner, one candidate, and one task. No connector credentials are sent
 * to ModelScope. The selected candidate's media repo/hash are verified before Telegram delivery.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, any> | null;
  if (!body || typeof body.ticket !== "string" || typeof body.model !== "string" || typeof body.run_id !== "string" || typeof body.bot_id !== "string") {
    return NextResponse.json({ ok: false, error: "invalid candidate delivery callback" }, { status: 400 });
  }

  const ticket = verifyDonorToolTicket(body.ticket);
  if (!ticket || ticket.model !== body.model || ticket.runId !== body.run_id || ticket.botId !== body.bot_id || tierFor(ticket.chatId) !== "owner") {
    return NextResponse.json({ ok: false, error: "invalid, expired, or cross-model ticket" }, { status: 403 });
  }
  if (!(await taskIsActive(ticket.runId))) {
    return NextResponse.json({ ok: false, error: "candidate task is no longer active" }, { status: 409 });
  }

  const profile = photoWeightProfile(ticket.model);
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 12000) : "";
  const media = Array.isArray(body.generated_media) ? body.generated_media.slice(0, 2) as GeneratedImage[] : [];
  if (!profile) return NextResponse.json({ ok: false, error: "no dedicated media assignment exists for this candidate" }, { status: 403 });

  const prepared: { bytes: Buffer; mime: string; extension: string; seed?: number }[] = [];
  const clips: { kind: "audio" | "video"; bytes: Buffer; mime: string; extension: string }[] = [];
  const mediaStudio = candidateMediaStudio(ticket.model);
  for (const item of media) {
    if (item && (item.kind === "audio" || item.kind === "video")) {
      // speech / video come only from THIS candidate's own media Studio (its own repo): anything else is refused
      const mime = String(item.mime || "").toLowerCase();
      const okMime = item.kind === "audio" ? mime === "audio/wav" : mime === "video/mp4";
      if (!mediaStudio || item.candidate !== ticket.model || item.media_studio !== mediaStudio.base || item.media_repo !== mediaStudio.repo || !okMime ||
          typeof item.b64 !== "string" || item.b64.length > 3_600_000) {
        return NextResponse.json({ ok: false, error: "generated " + item.kind + " failed candidate/studio validation" }, { status: 422 });
      }
      const bytes = Buffer.from(item.b64, "base64");
      if (bytes.length < 1000 || bytes.length > 2_700_000) {
        return NextResponse.json({ ok: false, error: "generated " + item.kind + " exceeds the callback transfer limit" }, { status: 413 });
      }
      clips.push({ kind: item.kind, bytes, mime, extension: item.kind === "audio" ? "wav" : "mp4" });
      continue;
    }
    if (!item || item.kind !== "image" || item.candidate !== ticket.model ||
        item.model_repo !== profile.modelRepo ||
        !/^[a-f0-9]{64}$/i.test(String(item.checkpoint_sha256 || "")) ||
        (profile.expectedCheckpointSha256 && String(item.checkpoint_sha256).toLowerCase() !== profile.expectedCheckpointSha256.toLowerCase()) ||
        !item.metadata || item.metadata.result !== "image_generated" ||
        item.metadata.model_repo !== profile.modelRepo ||
        String(item.metadata.checkpoint_sha256 || "").toLowerCase() !== String(item.checkpoint_sha256).toLowerCase()) {
      return NextResponse.json({ ok: false, error: "generated image failed candidate/model/hash validation" }, { status: 422 });
    }
    const mime = String(item.mime || "").toLowerCase();
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime) || typeof item.b64 !== "string" || item.b64.length > 4_000_000) {
      return NextResponse.json({ ok: false, error: "generated image MIME or payload size is invalid" }, { status: 413 });
    }
    const bytes = Buffer.from(item.b64, "base64");
    if (bytes.length < 1000 || bytes.length > 3_000_000) {
      return NextResponse.json({ ok: false, error: "generated image exceeds the callback transfer limit" }, { status: 413 });
    }
    prepared.push({ bytes, mime, extension: mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png", seed: item.seed });
  }

  if (!text && !prepared.length && !clips.length) {
    return NextResponse.json({ ok: false, error: "callback contains no user-visible result" }, { status: 400 });
  }

  const row = await candidateBot(ticket.botId!);
  if (!row) return NextResponse.json({ ok: false, error: "candidate Telegram bot is not active" }, { status: 503 });
  const bot = new Bot(row.token);
  const chatId = ticket.chatId;
  try {
    for (const piece of chunks(text)) {
      await bot.api.sendMessage(chatId, piece);
      await taskEvent(ticket.runId, "text", piece);
    }
    for (const [index, image] of prepared.entries()) {
      const file = new InputFile(image.bytes, ticket.model + "-generated-" + (index + 1) + "." + image.extension);
      const caption = "🖼 صورة مولّدة بواسطة " + ticket.model +
        "\nالوزن المستقل: " + profile.sourceModel +
        "\nمستودع الوسائط: " + profile.modelRepo +
        (image.seed !== undefined ? "\nSeed: " + image.seed : "");
      if (image.bytes.length <= 10 * 1024 * 1024 && image.mime !== "image/webp") {
        await bot.api.sendPhoto(chatId, file, { caption });
      } else {
        await bot.api.sendDocument(chatId, file, { caption });
      }
      await taskEvent(ticket.runId, "info", "✅ تم تسليم الصورة من الوزن المستقل " + profile.sourceModel + " إلى محادثة المرشح " + ticket.model + ".");
    }
    for (const [index, clip] of clips.entries()) {
      const file = new InputFile(clip.bytes, ticket.model + "-generated-" + (index + 1) + "." + clip.extension);
      if (clip.kind === "video") {
        await bot.api.sendVideo(chatId, file, { caption: "🎬 مقطع فيديو من استوديو الوسائط الخاص بـ " + ticket.model });
      } else {
        await bot.api.sendDocument(chatId, file, { caption: "🔊 تسجيل صوتي من استوديو الوسائط الخاص بـ " + ticket.model });
      }
      await taskEvent(ticket.runId, "info", "✅ تم تسليم " + (clip.kind === "video" ? "الفيديو" : "الصوت") + " من استوديو الوسائط الخاص بالمرشح " + ticket.model + ".");
    }
    if (body.failed === true) {
      await recordDonorAsyncDelivery(chatId, ticket.runId, ticket.model as "qwen35-9b" | "gemma4-e4b" | "minicpmo45", "", "").catch(() => false);
      await taskEvent(ticket.runId, "failed", "تعذّر إكمال الطلب.");
      await taskStatus(ticket.runId, "failed");
      return NextResponse.json({ ok: true, delivered: true, media_count: 0 }, { headers: { "Cache-Control": "no-store" } });
    }
    await recordDonorAsyncDelivery(chatId, ticket.runId, ticket.model as "qwen35-9b" | "gemma4-e4b" | "minicpmo45", String(body.prompt || ""), text).catch(() => false);
    await taskEvent(ticket.runId, "done", "اكتمل رد النموذج وتسليم الوسائط من استوديوه المخصص.");
    await taskStatus(ticket.runId, "done");
    return NextResponse.json({ ok: true, delivered: true, media_count: prepared.length + clips.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const reason = String((error as Error)?.message || error).slice(0, 500);
    await taskEvent(ticket.runId, "failed", "تعذّر تسليم نتيجة النموذج إلى تيليغرام: " + reason);
    await taskStatus(ticket.runId, "failed");
    console.error("[donor-media-callback]", reason);
    return NextResponse.json({ ok: false, error: "Telegram delivery failed" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
