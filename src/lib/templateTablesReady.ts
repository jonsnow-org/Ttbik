import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Templates whose Prisma tables may not exist yet in live Supabase
 * (owner must run the matching prisma/migration_N_*.sql once).
 *
 * Short aliases (QUIZ) and full template ids (QUIZ_BOT) both resolve.
 */
export const TEMPLATE_REQUIRED_TABLES: Record<string, string[]> = {
  QUIZ: ["QuizUser", "QuizResult"],
  QUIZ_BOT: ["QuizUser", "QuizResult"],
  STREAK: ["StreakUser", "StreakEntry"],
  STREAK_BOT: ["StreakUser", "StreakEntry"],
  PRAYER: ["PrayerUser"],
  PRAYER_BOT: ["PrayerUser"],
  CAPSULE: ["CapsuleUser", "Capsule"],
  CAPSULE_BOT: ["CapsuleUser", "Capsule"],
};

/** Same mapping as src/app/api/telegram/[botId]/route.ts MIGRATION_FOR_TEMPLATE. */
export const MIGRATION_FOR_TEMPLATE: Record<string, string> = {
  MARRIAGE_BOT: "migration_7_marriage_bot.sql",
  JOBS_BOT: "migration_16_jobs_bot.sql",
  MEDICAL_BOT: "migration_18_medical_bot.sql",
  NOVA_BOT: "migration_19_nova_ai.sql",
  CONFESSION_BOT: "migration_34_confession_bot.sql",
  NAME_COMPAT_BOT: "migration_35_name_compat_bot.sql",
  QUIZ: "migration_37_quiz_bot.sql",
  QUIZ_BOT: "migration_37_quiz_bot.sql",
  STREAK: "migration_38_streak_bot.sql",
  STREAK_BOT: "migration_38_streak_bot.sql",
  PRAYER: "migration_39_prayer_bot.sql",
  PRAYER_BOT: "migration_39_prayer_bot.sql",
  CAPSULE: "migration_40_capsule_bot.sql",
  CAPSULE_BOT: "migration_40_capsule_bot.sql",
  FADAA_BOT: "migration_fadaa.sql",
  ATHAR_BOT: "migration_full_current_schema.sql",
};

/** Templates that need a pre-deploy table check (Phase 1 guard). */
export const TEMPLATES_NEEDING_TABLE_CHECK = [
  "QUIZ_BOT",
  "STREAK_BOT",
  "PRAYER_BOT",
  "CAPSULE_BOT",
] as const;

export type TemplateNeedingCheck = (typeof TEMPLATES_NEEDING_TABLE_CHECK)[number];

export type TemplateReadyInfo = {
  template: string;
  ready: boolean;
  requiredTables: string[];
  missingTables: string[];
  migrationFile: string | null;
};

export function migrationFileForTemplate(template: string): string | null {
  return MIGRATION_FOR_TEMPLATE[template] ?? null;
}

export function requiredTablesForTemplate(template: string): string[] | null {
  return TEMPLATE_REQUIRED_TABLES[template] ?? null;
}

/** True when this template has required tables we must verify before deploy. */
export function templateNeedsTableCheck(template: string): boolean {
  return !!TEMPLATE_REQUIRED_TABLES[template];
}

/**
 * Probe one Prisma model table. Returns true if the table exists.
 * Uses findFirst + P2021 (table does not exist) — same pattern as
 * src/app/api/admin/bots/route.ts TABLE_PROBE.
 */
async function probePrismaTable(tableName: string): Promise<boolean> {
  try {
    switch (tableName) {
      case "QuizUser":
        await prisma.quizUser.findFirst({ select: { id: true } });
        return true;
      case "QuizResult":
        await prisma.quizResult.findFirst({ select: { id: true } });
        return true;
      case "StreakUser":
        await prisma.streakUser.findFirst({ select: { id: true } });
        return true;
      case "StreakEntry":
        await prisma.streakEntry.findFirst({ select: { id: true } });
        return true;
      case "PrayerUser":
        await prisma.prayerUser.findFirst({ select: { id: true } });
        return true;
      case "CapsuleUser":
        await prisma.capsuleUser.findFirst({ select: { id: true } });
        return true;
      case "Capsule":
        await prisma.capsule.findFirst({ select: { id: true } });
        return true;
      default:
        return await tableExistsViaInformationSchema(tableName);
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
      return false;
    }
    // Unknown errors (e.g. connection): treat as not ready so deploy is blocked safely.
    return false;
  }
}

/** Single-table check via information_schema (Postgres / Supabase). */
async function tableExistsViaInformationSchema(tableName: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ${tableName}
      ) AS "exists"
    `;
    return !!rows[0]?.exists;
  } catch {
    return false;
  }
}

/** Which of the given table names currently exist in public schema. */
export async function whichTablesExist(tableNames: string[]): Promise<{
  existing: string[];
  missing: string[];
}> {
  if (tableNames.length === 0) return { existing: [], missing: [] };

  // Prefer a single information_schema round-trip when possible.
  try {
    const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      tableNames
    );
    const existingSet = new Set(rows.map((r) => r.table_name));
    const existing = tableNames.filter((t) => existingSet.has(t));
    const missing = tableNames.filter((t) => !existingSet.has(t));
    return { existing, missing };
  } catch {
    // Fall back to per-table Prisma probes (P2021).
    const existing: string[] = [];
    const missing: string[] = [];
    for (const name of tableNames) {
      if (await probePrismaTable(name)) existing.push(name);
      else missing.push(name);
    }
    return { existing, missing };
  }
}

/** Readiness for one template id (e.g. QUIZ_BOT). */
export async function getTemplateReadyInfo(template: string): Promise<TemplateReadyInfo> {
  const required = requiredTablesForTemplate(template) ?? [];
  if (required.length === 0) {
    return {
      template,
      ready: true,
      requiredTables: [],
      missingTables: [],
      migrationFile: migrationFileForTemplate(template),
    };
  }
  const { missing } = await whichTablesExist(required);
  return {
    template,
    ready: missing.length === 0,
    requiredTables: required,
    missingTables: missing,
    migrationFile: migrationFileForTemplate(template),
  };
}

/**
 * Check which gated templates have their SQL tables ready.
 * Default list: QUIZ_BOT / STREAK_BOT / PRAYER_BOT / CAPSULE_BOT.
 */
export async function getTemplatesTablesReady(
  templates: readonly string[] = TEMPLATES_NEEDING_TABLE_CHECK
): Promise<TemplateReadyInfo[]> {
  const results: TemplateReadyInfo[] = [];
  for (const template of templates) {
    results.push(await getTemplateReadyInfo(template));
  }
  return results;
}

/**
 * Arabic error for deploy API when tables are missing.
 * Names the prisma/migration_*.sql file the owner must run in Supabase.
 */
export function missingTablesArabicError(info: TemplateReadyInfo): string {
  const file = info.migrationFile || "migration_full_current_schema.sql";
  const missing =
    info.missingTables.length > 0 ? info.missingTables.join(", ") : info.requiredTables.join(", ");
  return (
    `جداول هذا القالب غير موجودة في قاعدة البيانات بعد (${missing}).` +
    `\nشغّل الملف prisma/${file} مرة واحدة في Supabase ← SQL Editor ثم أعد المحاولة.`
  );
}
