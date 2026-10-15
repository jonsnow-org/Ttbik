import { NextRequest, NextResponse } from "next/server";
import { isRateLimited, requestIp } from "@/lib/rateLimit";
import {
  appsOf, award, createApp, deleteApp, forgetMind, getApp, hubUid, keyMatches, leaderboard, logMood, moodHistory, newWebId, profile,
  redeemBasharCredit, saveApp, setDisplayName, takeQuota,
} from "@/lib/hub/hubDb";
import { applyChatEdit, AppTemplate, APP_TEMPLATES, validateAppConfig } from "@/lib/hub/appConfig";
import {
  buildAppWithAi, draftLegalDoc, EXERCISES, legalAnalyze, MAX_INPUT, mindReply, PSYCHOED, repurpose, translateDialect,
} from "@/lib/hub/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COOKIE = "hub_id";
const AI_ACTIONS = new Set(["dialect", "repurpose", "legal_analyze", "mind_chat", "app_create"]);

function country(req: NextRequest): string | null {
  const cc = (req.headers.get("x-vercel-ip-country") || "").toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}
const err = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const text = (v: unknown, max = MAX_INPUT) => String(v ?? "").trim().slice(0, max);

/** One endpoint, action in the JSON body (same pattern as /api/bashar). Edit keys travel in the body only, never in the URL. */
export async function POST(req: NextRequest) {
  const ip = requestIp(req);
  if (isRateLimited(`hub:${ip}`, 30, 60_000)) return err("طلبات كثيرة، انتظر دقيقة.", 429);
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return err("طلب غير صالح");
  }
  let raw = req.cookies.get(COOKIE)?.value || "";
  const fresh = !/^[a-f0-9]{32}$/.test(raw);
  if (fresh) raw = newWebId();
  const uid = hubUid("web", raw);
  const action = String(body.action || "");
  let out: Record<string, unknown> = {};
  try {
    if (AI_ACTIONS.has(action)) {
      if (isRateLimited(`hub-ai:${ip}`, 8, 60_000)) return err("انتظر قليلاً بين الطلبات.", 429);
      if (!(await takeQuota(uid))) return err("انتهى حدّك المجاني اليومي (25 طلب ذكاء اصطناعي). يتجدد غداً.", 429);
    }
    switch (action) {
      case "state": {
        await award(uid, "daily");
        out = { profile: await profile(uid), apps: await appsOf(uid), board: await leaderboard(10) };
        break;
      }
      case "set_name":
        await setDisplayName(uid, text(body.name, 24));
        out = { profile: await profile(uid) };
        break;
      case "redeem_bashar": {
        let bid = req.cookies.get("bashar_id")?.value || "";
        if (!/^[a-zA-Z0-9]{8,40}$/.test(bid)) return err("افتح صفحة «بشر» مرة أولاً ثم ارجع هنا.");
        const r = await redeemBasharCredit(uid, bid);
        if (!r.ok) return err(r.error || "تعذر الاستبدال");
        out = { profile: await profile(uid) };
        break;
      }
      case "dialect": {
        const t = text(body.text);
        if (t.length < 2) return err("اكتب النص أولاً");
        const r = await translateDialect(t, text(body.from, 20), text(body.to, 20));
        if (r.ok) await award(uid, "tool_use");
        out = { result: r.text };
        break;
      }
      case "repurpose": {
        const t = text(body.text);
        if (t.length < 80) return err("ألصق مقالاً لا يقل عن 80 حرفاً");
        const r = await repurpose(t, text(body.format, 20));
        await award(uid, "tool_use");
        out = { result: r.text, engine: r.engine };
        break;
      }
      case "legal_analyze": {
        const t = text(body.text);
        if (t.length < 20) return err("اكتب وقائع القضية بتفصيل أكثر (20 حرفاً على الأقل)");
        const r = await legalAnalyze(t, text(body.country, 2));
        if (!r.refused) await award(uid, "tool_use");
        out = { result: r.text, refused: !!r.refused };
        break;
      }
      case "legal_draft": {
        const d = draftLegalDoc(text(body.kind, 20), (body.values && typeof body.values === "object" ? body.values : {}) as Record<string, string>, text(body.country, 2));
        if (!d) return err("نوع المستند غير معروف");
        await award(uid, "doc_draft");
        out = { result: d };
        break;
      }
      case "mind_chat": {
        const t = text(body.text, 1200);
        if (!t) return err("اكتب ما تشعر به");
        const r = await mindReply(t, text(body.country, 2) || country(req));
        out = { result: r.text, crisis: r.crisis }; // no chat text is stored
        break;
      }
      case "mind_tip": {
        const k = text(body.key, 20);
        out = { result: EXERCISES[k] || PSYCHOED[k] || "غير موجود" };
        break;
      }
      case "mood_log": {
        const s = Number(body.score);
        if (!(s >= 1 && s <= 5)) return err("اختر من 1 إلى 5");
        await logMood(uid, s);
        await award(uid, "mood_log");
        out = { history: await moodHistory(uid) };
        break;
      }
      case "mood_history":
        out = { history: await moodHistory(uid) };
        break;
      case "forget":
        await forgetMind(uid);
        out = { result: "تم حذف سجل مزاجك وكل حالة محادثة محفوظة لك." };
        break;
      case "app_create": {
        const tpl = text(body.template, 20) as AppTemplate;
        const desc = text(body.text, 1500);
        if (desc.length < 5) return err("صف تطبيقك بجملة على الأقل");
        const built = await buildAppWithAi(desc, tpl in APP_TEMPLATES ? tpl : undefined);
        if (body.contact) built.config.contact = text(body.contact, 80).replace(/[^\w@+.:/\-]/g, "") || undefined;
        const r = await createApp(uid, built.config);
        if (!r.ok) return err(r.error);
        await award(uid, "app_create");
        out = { slug: r.slug, editKey: r.editKey, config: built.config, engine: built.engine };
        break;
      }
      case "app_edit": {
        const app = await getApp(text(body.slug, 40));
        if (!app) return err("التطبيق غير موجود", 404);
        const owner = app.owner_uid === uid || keyMatches(text(body.editKey, 64), app.edit_key_hash);
        if (!owner) return err("مفتاح التعديل غير صحيح", 403);
        let next = app.config;
        if (body.config) {
          const v = validateAppConfig(body.config);
          if (!v.ok) return err(v.error);
          next = v.config;
        } else {
          const e = applyChatEdit(app.config, text(body.text, 300));
          if (!e.changed) return err("لم أفهم التعديل. أمثلة: «غيّر الاسم إلى …»، «اللون أحمر»، «أضف قهوة بسعر 3$»، «احذف قهوة»");
          next = e.config;
        }
        await saveApp(app.slug, next);
        await award(uid, "app_update");
        out = { config: next };
        break;
      }
      case "app_delete": {
        const app = await getApp(text(body.slug, 40));
        if (!app) return err("التطبيق غير موجود", 404);
        if (!(app.owner_uid === uid || keyMatches(text(body.editKey, 64), app.edit_key_hash))) return err("مفتاح التعديل غير صحيح", 403);
        await deleteApp(app.slug);
        out = { deleted: true };
        break;
      }
      default:
        return err("إجراء غير معروف");
    }
  } catch (e) {
    console.error("[hub]", action, e instanceof Error ? e.message : e);
    return err("حدث خطأ مؤقت، حاول مرة أخرى.", 500);
  }
  const res = NextResponse.json({ ok: true, ...out });
  if (fresh) res.cookies.set(COOKIE, raw, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365, path: "/" });
  return res;
}
