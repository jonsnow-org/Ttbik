import { NextRequest, NextResponse } from "next/server";
import { isRateLimited, requestIp } from "@/lib/rateLimit";
import {
  ANSWER_SECONDS,
  answer,
  answersFor,
  ask,
  liveStats,
  reply,
  reportAnswer,
  claim,
  cleanText,
  countryLabel,
  expireStale,
  getQuestion,
  newId,
  onlineCount,
  release,
  report,
  touchPlayer,
} from "@/lib/bashar";

export const dynamic = "force-dynamic";

const COOKIE = "bashar_id";

function country(req: NextRequest): string | null {
  const cc = (req.headers.get("x-vercel-ip-country") || "").toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

/**
 * One endpoint, action in the body:
 *   state            → credits, online count
 *   ask {text}       → spend 1 credit, returns question id
 *   poll {id}        → status of my question (answer / expired)
 *   claim            → get someone else's question to answer (75s)
 *   answer {id,text} → +1 credit if within time
 *   skip {id}        → release a claimed question
 *   report {id}      → hide after 2 reports
 *   view {id}        → a question + its answers (shared link)
 *   reply {id,text}  → answer a question opened from its shared link
 *   report_answer {id}
 * GET → live numbers for the floating bubble (no cookie, cached 15s).
 */
export async function GET() {
  try {
    return NextResponse.json(await liveStats(), { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } });
  } catch {
    return NextResponse.json({ online: 0, today: 0, total: 0, waiting: 0 });
  }
}

export async function POST(req: NextRequest) {
  const ip = requestIp(req);
  if (isRateLimited(`bashar:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: "طلبات كثيرة، تمهّل قليلاً" }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "state");

  let player = req.cookies.get(COOKIE)?.value || "";
  const fresh = !/^[a-f0-9]{16}$/.test(player);
  if (fresh) player = newId();

  try {
    const me = await touchPlayer(player);
    let out: Record<string, unknown>;

    switch (action) {
      case "ask": {
        if (isRateLimited(`bashar-ask:${ip}`, 6, 10 * 60_000)) {
          out = { error: "أرسلت أسئلة كثيرة، انتظر دقائق" };
          break;
        }
        const t = cleanText(body.text);
        if (!t.ok) {
          out = { error: t.error };
          break;
        }
        const r = await ask(player, t.text, country(req));
        out = r.ok ? { id: r.id, credits: r.credits } : { error: "no_credits", credits: me.credits };
        break;
      }
      case "poll": {
        await expireStale();
        const q = await getQuestion(String(body.id || ""));
        if (!q || q.asker !== player) {
          out = { error: "not_found" };
          break;
        }
        const list = await answersFor(q.id, 20);
        out = {
          answer: q.hidden ? null : q.answer,
          from: q.answer ? countryLabel(q.answer_cc) : null,
          expired: q.expired && list.length === 0,
          answers: list.map((a) => ({ id: a.id, text: a.body, from: countryLabel(a.cc) })),
        };
        break;
      }
      case "claim": {
        await expireStale();
        const q = await claim(player);
        out = q
          ? {
              id: q.id,
              text: q.body,
              from: countryLabel(q.asker_cc),
              deadline: new Date(q.claimed_at).getTime() + ANSWER_SECONDS * 1000,
            }
          : { empty: true };
        break;
      }
      case "answer": {
        const t = cleanText(body.text);
        if (!t.ok) {
          out = { error: t.error };
          break;
        }
        const r = await answer(player, String(body.id || ""), t.text, country(req));
        out = r.ok ? { ok: true, credits: r.credits } : { error: "انتهى الوقت — جرّب سؤالاً آخر" };
        break;
      }
      case "view": {
        const q = await getQuestion(String(body.id || ""));
        if (!q || q.hidden) {
          out = { error: "not_found" };
          break;
        }
        const list = await answersFor(q.id, 30);
        out = {
          id: q.id,
          text: q.body,
          from: countryLabel(q.asker_cc),
          mine: q.asker === player,
          answers: list.map((a) => ({ id: a.id, text: a.body, from: countryLabel(a.cc) })),
        };
        break;
      }
      case "reply": {
        const t = cleanText(body.text);
        if (!t.ok) {
          out = { error: t.error };
          break;
        }
        const r = await reply(player, String(body.id || ""), t.text, country(req));
        out = r.ok ? { ok: true } : { error: r.error };
        break;
      }
      case "report_answer":
        await reportAnswer(String(body.id || ""));
        out = { ok: true };
        break;
      case "skip":
        await release(player, String(body.id || ""));
        out = { ok: true };
        break;
      case "report":
        await report(String(body.id || ""));
        out = { ok: true };
        break;
      default:
        out = {};
    }

    const fresh2 = await touchPlayer(player);
    const res = NextResponse.json({ ...out, credits: fresh2.credits, answered: fresh2.answered, online: await onlineCount() });
    if (fresh) {
      res.cookies.set(COOKIE, player, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365 });
    }
    return res;
  } catch (e) {
    console.error("bashar", e);
    return NextResponse.json({ error: "الخدمة غير متاحة مؤقتاً" }, { status: 503 });
  }
}
