import { InputFile, type Bot as TelegramBot } from "grammy";
import { prismaDb, tierFor, type Db } from "@/lib/coderAuth";
import { later } from "@/lib/coderRuntime";
import { taskEvent, taskIsActive, taskSlot, taskStart, taskStatus, taskTouch, stopTaskRow } from "@/lib/coderTasks";

export type ImageGenerationTestId = "umranz" | "cyberrealistic" | "juggernaut-ragnarok";

export const IMAGE_GENERATION_TESTS = [
  {
    id: "umranz",
    studio: "umranz-sd15-image-test",
    name: { ar: "Umranz SD1.5 Photoreal", en: "Umranz SD1.5 Photoreal" },
    revision: "image-generation-bakeoff-2026-10-31-r1",
    aspect: "512 × 768",
    steps: 30,
    cfg: 6.5,
    negative: "cartoon, anime, illustration, drawing, painting, cgi, 3d render, doll, plastic skin, waxy skin, airbrushed, deformed eyes, bad anatomy, malformed hands, extra fingers, fused fingers, extra limbs, blurry, low quality, watermark, text",
  },
  {
    id: "cyberrealistic",
    studio: "cyberrealistic-final-test",
    name: { ar: "CyberRealistic FINAL FP16", en: "CyberRealistic FINAL FP16" },
    revision: null,
    aspect: "512 × 768 (author recommended)",
    steps: 30,
    cfg: 5.0,
    negative: "(cartoon, anime, illustration, drawing, painting, cgi, 3d render, doll, plastic skin, waxy skin, airbrushed, synthetic face), deformed eyes, asymmetrical eyes, bad anatomy, bad proportions, malformed hands, extra fingers, fused fingers, missing fingers, extra limbs, duplicate person, blurry, low quality, jpeg artifacts, watermark, logo, text",
  },
  {
    id: "juggernaut-ragnarok",
    studio: "juggernaut-ragnarok-image-test",
    name: { ar: "Juggernaut XL Ragnarok FP8", en: "Juggernaut XL Ragnarok FP8" },
    revision: "image-generation-bakeoff-2026-10-31-r1",
    aspect: "768 × 1024",
    steps: 30,
    cfg: 5.0,
    negative: "cartoon, anime, illustration, drawing, painting, cgi, 3d render, doll, plastic skin, waxy skin, deformed eyes, asymmetrical eyes, bad anatomy, malformed hands, extra fingers, fused fingers, extra limbs, blurry, low quality, watermark, text",
  },
] as const;

const OWNER = "novaai2026";
const MODEL_SCOPE = "https://www.modelscope.cn";
const tokenOf = () => (process.env.MODELSCOPE_API_TOKEN || process.env.MODELSCOPE_TOKEN || "").trim();
const configOf = (id: string) => {
  const found = IMAGE_GENERATION_TESTS.find((item) => item.id === id);
  if (!found) throw new Error("مرشح توليد الصور غير معروف.");
  return found;
};
const apiOf = (studio: string) => `https://studio-${OWNER}-${studio}.api-inference.modelscope.net`;
const headers = (token: string) => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });

function statusObject(value: unknown): Record<string, any> | null {
  if (Array.isArray(value)) value = value[0];
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" ? value as Record<string, any> : null;
}

async function readSse(response: Response, maxBytes = 4_000_000): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let size = 0;
  try {
    while (size < maxBytes) {
      const part = await reader.read();
      if (part.done) break;
      raw += decoder.decode(part.value, { stream: true });
      size += part.value.length;
      if (/(^|\r?\n)event:\s*complete\r?\ndata:[^\r\n]*(?:\r?\n\r?\n|$)/m.test(raw)) return raw;
      if (/(^|\r?\n)event:\s*error(?:\r?\n|$)/m.test(raw)) {
        throw new Error("أعاد استديو التوليد حدث خطأ.");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  throw new Error("انتهت مهلة انتظار اكتمال توليد الصورة.");
}

function sseValues(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try { out.push(JSON.parse(line.slice(5).trim())); } catch { /* ignore heartbeat */ }
    }
  }
  return out;
}

function findImage(value: unknown): Record<string, any> | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findImage(child);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    const item = value as Record<string, any>;
    if (typeof item.path === "string" || typeof item.url === "string") return item;
    for (const child of Object.values(item)) {
      const found = findImage(child);
      if (found) return found;
    }
  }
  return null;
}

function findMeta(value: unknown): Record<string, any> | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findMeta(child);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    const item = value as Record<string, any>;
    if (item.result === "image_generated") return item;
    for (const child of Object.values(item)) {
      const found = findMeta(child);
      if (found) return found;
    }
  }
  return null;
}

function validateImagePrompt(prompt: string): void {
  const minor = /\b(?:child|children|minor|underage|teen|teenager|schoolgirl|schoolboy|loli|shota)\b|طفل|طفلة|قاصر|قاصرة|مراهق|مراهقة|تلميذ|تلميذة/iu;
  const sexual = /\b(?:nude|naked|nudity|sex|sexual|erotic|porn|explicit|undress)\b|عاري|عارية|تعري|جنس|جنسي|إباحي|إباحية/iu;
  const nonconsensual = /\b(?:non[- ]consensual|without consent|revenge porn|deepfake|undress (?:her|him|them)|make (?:her|him|them) naked)\b|بدون موافقة|دون موافقة|صور حميمة مسربة|تعرية شخص|انتهاك الخصوصية/iu;
  const realPerson = /\b(?:real person|celebrity|public figure|my ex|my wife|my girlfriend|my colleague|my coworker)\b|شخص حقيقي|شخصية عامة|مشهور|مشاهير|زوجتي|زوجة|طليقتي|حبيبتي|زميلتي|زميلي/iu;
  if (minor.test(prompt) && sexual.test(prompt)) {
    throw new Error("لا يمكن إرسال طلب يصوّر قاصراً أو شخصاً يبدو قاصراً في سياق جنسي.");
  }
  if (nonconsensual.test(prompt) && realPerson.test(prompt)) {
    throw new Error("لا يمكن إنشاء صور حميمة أو تزييف جنسي لأشخاص حقيقيين دون موافقتهم.");
  }
}

export type ImageTestReadiness = {
  id: ImageGenerationTestId;
  phase: "ready" | "loading" | "error" | "deploying" | "not_created" | "unavailable" | "unconfigured";
  detail?: string;
};

export async function probeImageGenerationStudio(
  id: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ImageTestReadiness> {
  const config = configOf(id);
  const token = tokenOf();
  if (!token) return { id: config.id, phase: "unconfigured", detail: "رمز ModelScope غير مضبوط على الخادم." };
  try {
    const lookup = await fetchImpl(
      MODEL_SCOPE + "/openapi/v1/studios/" + OWNER + "/" + config.studio,
      { headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (lookup.status === 404) return { id: config.id, phase: "not_created", detail: "لم يُنشأ الاستديو الخاص بهذا المرشح بعد." };
    if (!lookup.ok) return { id: config.id, phase: "unavailable", detail: "تعذّر فحص ModelScope: HTTP " + lookup.status };
    const body = await lookup.json().catch(() => ({})) as Record<string, any>;
    const data = body.data || body.Data || body;
    const runtime = data.runtime || {};
    const runtimeState = String(runtime.status || data.status || "").toLowerCase();
    if (!["running", "ready"].includes(runtimeState)) {
      return { id: config.id, phase: "deploying", detail: "حالة الاستديو الحالية: " + (runtimeState || "غير معروفة") };
    }
    const statusResponse = await fetchImpl(apiOf(config.studio) + "/gradio_api/run/status", {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ data: [] }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!statusResponse.ok) {
      return { id: config.id, phase: "unavailable", detail: "واجهة النموذج لا تستجيب: HTTP " + statusResponse.status };
    }
    const direct = await statusResponse.json() as Record<string, any>;
    const status = statusObject(direct.data ?? direct);
    if (!status) return { id: config.id, phase: "unavailable", detail: "استجابة حالة النموذج غير صالحة." };
    const phase = String(status.phase || "unavailable").toLowerCase();
    if (phase !== "ready") {
      return {
        id: config.id,
        phase: phase === "loading" ? "loading" : phase === "error" ? "error" : "deploying",
        detail: String(status.error || status.phase || "النموذج لم يصبح جاهزاً بعد").slice(0, 240),
      };
    }
    if (config.revision && status.app_revision !== config.revision) {
      return { id: config.id, phase: "deploying", detail: "يعمل الاستديو بإصدار مختلف؛ انتظر اكتمال نشر المشغّل الجديد." };
    }
    if (id === "cyberrealistic" && status.creator_sha256_verified !== true) {
      return { id: config.id, phase: "error", detail: "لم يؤكد الاستديو سلامة SHA-256 الخاص بملف CyberRealistic." };
    }
    return { id: config.id, phase: "ready" };
  } catch (error) {
    return { id: config.id, phase: "unavailable", detail: String((error as Error)?.message || error).slice(0, 240) };
  }
}


export async function startImageGenerationTest(
  bot: TelegramBot,
  chatId: number,
  prompt: string,
  botId: string,
  db: Db = prismaDb,
  expectedModel?: ImageGenerationTestId,
  fetchImpl: typeof fetch = globalThis.fetch,
  botSecret = "",
): Promise<{ runId: string }> {
  if (tierFor(chatId) !== "owner") throw new Error("اختبارات توليد الصور متاحة للمالك فقط.");
  const cleanPrompt = String(prompt || "").trim();
  if (cleanPrompt.length < 8) throw new Error("أرسل وصفاً أطول للصورة.");
  if (cleanPrompt.length > 1800) throw new Error("وصف الصورة طويل جداً؛ الحد 1800 حرف.");
  validateImagePrompt(cleanPrompt);

  const state = await loadImageTestState(chatId, db);
  const id = state.imageTestModel;
  if (!id || !isImageGenerationTestId(id)) throw new Error("لم يتم اختيار مرشح توليد الصور من قائمة /models.");
  if (expectedModel && id !== expectedModel) throw new Error("اختيار المرشح تغيّر؛ أعد إرسال الطلب.");
  const readiness = await probeImageGenerationStudio(id, fetchImpl);
  if (readiness.phase !== "ready") {
    throw new Error(
      "المرشح " + configOf(id).name.ar + " غير جاهز (" + readiness.phase + "). " +
      (readiness.detail || "") + " لم يتم تحويل الطلب إلى Nova أو Sham أو مرشح آخر.",
    );
  }
  const previous = state.imageTestInFlight?.[id];
  if (previous && await taskIsActive(previous, db)) {
    throw new Error("يوجد توليد جارٍ لهذا المرشح. انتظر النتيجة أو أرسل /stop.");
  }

  const runId = "image-" + id + "-" + cryptoRandomId();
  const seed = Math.floor(Math.random() * 2_000_000_000);
  const inFlight = { ...(state.imageTestInFlight || {}), [id]: runId };
  state.imageTestInFlight = inFlight;
  state.imageTestJobs = {
    ...(state.imageTestJobs || {}),
    [id]: { runId, prompt: cleanPrompt, seed, attempt: 0 },
  };
  await saveImageTestState(chatId, state, db);
  const label = configOf(id).name.ar;
  await taskStart(chatId, {
    runId,
    slot: "image-model:" + id,
    source: "interactive",
    title: "🖼️ " + label + ": " + cleanPrompt.slice(0, 140),
    botId,
  }, db);
  await taskEvent(runId, "info", "إرسال طلب صورة إلى الاستديو الخاص بالمرشح فقط.", db);
  later(() => runImageGenerationTask(bot, chatId, runId, id, cleanPrompt, seed, botId, botSecret, db, fetchImpl));
  void bot.api.sendChatAction(chatId, "upload_photo").catch(() => null);
  return { runId };
}

async function runImageGenerationTask(
  bot: TelegramBot,
  chatId: number,
  runId: string,
  id: ImageGenerationTestId,
  prompt: string,
  seed: number,
  botId: string,
  botSecret: string,
  db: Db,
  fetchImpl: typeof fetch,
): Promise<void> {
  const config = configOf(id);
  const heartbeat = setInterval(() => { void taskTouch(runId, db).catch(() => null); }, 15_000);
  try {
    if (!(await taskIsActive(runId, db))) return;
    await taskEvent(runId, "info", "إرسال مهمة التوليد إلى الاستديو الخاص بالمرشح…", db);
    const token = tokenOf();
    if (!token) throw new Error("رمز ModelScope غير مضبوط على الخادم.");
    const start = await fetchImpl(apiOf(config.studio) + "/gradio_api/call/image", {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ data: [prompt, config.negative, config.aspect, config.steps, config.cfg, seed] }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!start.ok) {
      const detail = (await start.text().catch(() => "")).slice(0, 300);
      throw new Error("رفض الاستديو الطلب: HTTP " + start.status + (detail ? " · " + detail : ""));
    }
    const started = await start.json().catch(() => ({})) as { event_id?: string };
    if (!started.event_id) throw new Error("لم يُرجع الاستديو معرّف مهمة التوليد.");
    const state = await loadImageTestState(chatId, db);
    const job = state.imageTestJobs?.[id];
    if (!job || job.runId !== runId) return;
    state.imageTestJobs = {
      ...(state.imageTestJobs || {}),
      [id]: { ...job, eventId: started.event_id },
    };
    await saveImageTestState(chatId, state, db);
    await taskEvent(runId, "info", "بدأ الاستديو التوليد فعلياً. تم تسجيل رقم المهمة ومتابعتها عبر جلسات تنفيذ مستقلة.", db);
    await invokeImageContinuation(botId, chatId, runId, botSecret, fetchImpl);
  } catch (error) {
    await failImageTest(bot, chatId, runId, id, String((error as Error)?.message || error), db);
  } finally {
    clearInterval(heartbeat);
  }
}

async function invokeImageContinuation(
  botId: string,
  chatId: number,
  runId: string,
  botSecret: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const { selfUrl, signContinue } = await import("@/lib/coderSections");
  const sig = signContinue(botSecret || "", botId, String(chatId), runId);
  const response = await fetchImpl(selfUrl() + "/api/image-test/continue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ botId, chatId: String(chatId), runId, sig }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok && response.status !== 202) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error("تعذّر تشغيل عامل متابعة التوليد: HTTP " + response.status + (detail ? " · " + detail : ""));
  }
}

export async function continueImageGenerationTest(
  bot: TelegramBot,
  chatId: number,
  botId: string,
  botSecret: string,
  runId: string,
  db: Db = prismaDb,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  const state = await loadImageTestState(chatId, db);
  const entry = Object.entries(state.imageTestJobs || {}).find(([, job]) => job?.runId === runId);
  if (!entry) return;
  const [rawId, job] = entry as [string, ImageTestJob];
  if (!isImageGenerationTestId(rawId) || !job.eventId) return;
  const id = rawId;
  if (!(await taskIsActive(runId, db))) {
    await clearImageTestJob(chatId, id, runId, db);
    return;
  }

  const heartbeat = setInterval(() => { void taskTouch(runId, db).catch(() => null); }, 15_000);
  try {
    await taskEvent(runId, "info", "متابعة نتيجة التوليد من الاستديو… المحاولة " + (job.attempt + 1) + ".", db);
    let response: Response;
    try {
      response = await fetchImpl(
        apiOf(configOf(id).studio) + "/gradio_api/call/image/" + encodeURIComponent(job.eventId),
        {
          headers: headers(tokenOf()),
          cache: "no-store",
          signal: AbortSignal.timeout(235_000),
        },
      );
    } catch (error) {
      const message = String((error as Error)?.message || error);
      await continueOrFail(bot, chatId, botId, botSecret, runId, id, job, "انقطع انتظار النتيجة مؤقتاً: " + message, db, fetchImpl);
      return;
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error("أعاد الاستديو HTTP " + response.status + (detail ? " · " + detail : ""));
    }
    let raw: string;
    try {
      raw = await readSse(response);
    } catch (error) {
      await continueOrFail(bot, chatId, botId, botSecret, runId, id, job, String((error as Error)?.message || error), db, fetchImpl);
      return;
    }
      if (/(^|\r?\n)event:\s*complete\r?\ndata:[^\r\n]*(?:\r?\n\r?\n|$)/m.test(raw)) return raw;
      await continueOrFail(bot, chatId, botId, botSecret, runId, id, job, "لم يكتمل التدفق في جلسة المتابعة الحالية.", db, fetchImpl);
      return;
    }
    const values = sseValues(raw);
    const image = values.map(findImage).find(Boolean) || null;
    const meta = values.map(findMeta).find(Boolean) || null;
    if (!image) throw new Error("أكمل الاستديو الطلب دون إعادة ملف الصورة.");
    const filePath = String(image.path || image.url || "");
    let fileUrl: string;
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
      fileUrl = filePath;
    } else if (filePath.startsWith("/gradio_api/file=")) {
      fileUrl = apiOf(configOf(id).studio) + filePath;
    } else {
      const normalized = filePath.startsWith("/") ? filePath : "/" + filePath;
      fileUrl = apiOf(configOf(id).studio) + "/gradio_api/file=" + encodeURIComponent(normalized).replace(/%2F/gi, "/");
    }
    const token = tokenOf();
    const downloaded = await fetchImpl(fileUrl, {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    if (!downloaded.ok) throw new Error("تعذّر تنزيل ملف الصورة من الاستديو: HTTP " + downloaded.status);
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    if (bytes.byteLength < 10_000 || bytes.byteLength > 48 * 1024 * 1024) {
      throw new Error("حجم ملف الصورة غير صالح للاختبار: " + bytes.byteLength + " bytes.");
    }
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!png && !jpeg) throw new Error("الملف المستلم ليس صورة PNG أو JPEG سليمة.");

    if (!(await taskIsActive(runId, db))) return;
    const config = configOf(id);
    const seed = job.seed;
    const caption = [
      "🖼️ " + config.name.ar,
      "Seed: " + seed,
      "الوقت: " + String(meta?.seconds ?? "—") + "s",
      meta?.resolution ? "الدقة: " + String(meta.resolution) : "",
    ].filter(Boolean).join("\n").slice(0, 900);
    const buffer = Buffer.from(bytes);
    try {
      await bot.api.sendPhoto(chatId, new InputFile(buffer, id + ".png"), { caption });
    } catch {
      await bot.api.sendDocument(chatId, new InputFile(buffer, id + ".png"), { caption });
    }
    await taskEvent(runId, "info", "اكتمل التوليد. Seed=" + seed + " · " + bytes.byteLength + " bytes.", db);
    await taskStatus(runId, "done", undefined, db);
    await clearImageTestJob(chatId, id, runId, db);
  } catch (error) {
    await failImageTest(bot, chatId, runId, id, String((error as Error)?.message || error), db);
  } finally {
    clearInterval(heartbeat);
  }
}

async function continueOrFail(
  bot: TelegramBot,
  chatId: number,
  botId: string,
  botSecret: string,
  runId: string,
  id: ImageGenerationTestId,
  job: ImageTestJob,
  reason: string,
  db: Db,
  fetchImpl: typeof fetch,
): Promise<void> {
  const nextAttempt = (job.attempt || 0) + 1;
  if (nextAttempt > 6) {
    await failImageTest(bot, chatId, runId, id, "تجاوز التوليد الحد الأقصى لمدة المتابعة (نحو 24 دقيقة). " + reason, db);
    return;
  }
  const state = await loadImageTestState(chatId, db);
  if (state.imageTestJobs?.[id]?.runId !== runId) return;
  state.imageTestJobs = {
    ...(state.imageTestJobs || {}),
    [id]: { ...job, attempt: nextAttempt },
  };
  await saveImageTestState(chatId, state, db);
  await taskEvent(runId, "info", "لا يزال التوليد قيد التنفيذ؛ سأتابع في جلسة مستقلة أخرى. " + reason.slice(0, 180), db);
  await invokeImageContinuation(botId, chatId, runId, botSecret, fetchImpl);
}

async function clearImageTestJob(chatId: number, id: ImageGenerationTestId, runId: string, db: Db): Promise<void> {
  const state = await loadImageTestState(chatId, db);
  if (state.imageTestInFlight?.[id] === runId) {
    const next = { ...(state.imageTestInFlight || {}) };
    delete next[id];
    state.imageTestInFlight = next;
  }
  if (state.imageTestJobs?.[id]?.runId === runId) {
    const next = { ...(state.imageTestJobs || {}) };
    delete next[id];
    state.imageTestJobs = next;
  }
  await saveImageTestState(chatId, state, db);
}

async function failImageTest(
  bot: TelegramBot,
  chatId: number,
  runId: string,
  id: ImageGenerationTestId,
  message: string,
  db: Db,
): Promise<void> {
  const notice = "⚠️ تعذّر توليد الصورة عبر " + configOf(id).name.ar + ": " + String(message || "").slice(0, 600) + " لم يتم استخدام نموذج بديل.";
  await taskEvent(runId, "failed", notice, db);
  await taskStatus(runId, "failed", undefined, db);
  await bot.api.sendMessage(chatId, notice).catch(() => null);
  await clearImageTestJob(chatId, id, runId, db);
}

export async function stopImageGenerationTest(chatId: number, db: Db = prismaDb): Promise<boolean> {
  if (tierFor(chatId) !== "owner") return false;
  const state = await loadImageTestState(chatId, db);
  const id = state.imageTestModel;
  if (!id || !isImageGenerationTestId(id)) return false;
  const runId = state.imageTestInFlight?.[id];
  if (!runId) return false;
  const slot = await taskSlot(runId, chatId, db);
  if (slot !== "image-model:" + id || !(await stopTaskRow(chatId, runId, db))) return false;
  const next = { ...(state.imageTestInFlight || {}) };
  delete next[id];
  state.imageTestInFlight = next;
  if (state.imageTestJobs?.[id]?.runId === runId) {
    const jobs = { ...(state.imageTestJobs || {}) };
    delete jobs[id];
    state.imageTestJobs = jobs;
  }
  await saveImageTestState(chatId, state, db);
  await taskEvent(runId, "info", "أوقف المستخدم إرسال نتيجة الاختبار. قد يواصل الاستديو الحساب حتى ينتهي طلبه.", db);
  return true;
}

function cryptoRandomId(): string {
  return globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10)
    || Math.random().toString(36).slice(2, 12);
}

type ImageTestJob = { runId: string; prompt: string; seed: number; eventId?: string; attempt: number };
type ImageTestState = Record<string, any> & {
  imageTestModel?: ImageGenerationTestId;
  imageTestInFlight?: Partial<Record<ImageGenerationTestId, string>>;
  imageTestJobs?: Partial<Record<ImageGenerationTestId, ImageTestJob>>;
};

async function loadImageTestState(chatId: number, db: Db): Promise<ImageTestState> {
  const { loadStateStrict } = await import("@/lib/coderSections");
  return await loadStateStrict(chatId, db) as ImageTestState;
}

async function saveImageTestState(chatId: number, state: ImageTestState, db: Db): Promise<void> {
  const { saveStateStrict } = await import("@/lib/coderSections");
  await saveStateStrict(chatId, state as any, db);
}
export function isImageGenerationTestId(value: string): value is ImageGenerationTestId {
  return IMAGE_GENERATION_TESTS.some((item) => item.id === value);
}
