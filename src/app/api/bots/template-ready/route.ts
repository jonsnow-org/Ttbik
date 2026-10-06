import { NextRequest, NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/isOwner";
import {
  TEMPLATES_NEEDING_TABLE_CHECK,
  getTemplatesTablesReady,
  migrationFileForTemplate,
} from "@/lib/templateTablesReady";

export const dynamic = "force-dynamic";

/**
 * GET /api/bots/template-ready
 * Owner-only (same cookie gate as /admin APIs). Returns which Phase-1
 * templates (QUIZ/STREAK/PRAYER/CAPSULE) have their SQL tables ready,
 * plus the migration filename hint for each.
 */
export async function GET(req: NextRequest) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  try {
    const templates = await getTemplatesTablesReady(TEMPLATES_NEEDING_TABLE_CHECK);
    const byTemplate: Record<
      string,
      { ready: boolean; requiredTables: string[]; missingTables: string[]; migrationFile: string | null }
    > = {};
    for (const t of templates) {
      byTemplate[t.template] = {
        ready: t.ready,
        requiredTables: t.requiredTables,
        missingTables: t.missingTables,
        migrationFile: t.migrationFile,
      };
    }

    return NextResponse.json({
      ok: true,
      templates: byTemplate,
      // Flat hints for the deploy form UI
      migrations: Object.fromEntries(
        TEMPLATES_NEEDING_TABLE_CHECK.map((id) => [id, migrationFileForTemplate(id)])
      ),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "فشل فحص الجداول";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
