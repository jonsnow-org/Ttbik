import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/config";
export async function GET() {
  return NextResponse.json({
    name: "أثر · Athar",
    description: "رمز لكل يوم في التقويم (1950–2049). يحفظ ذاكرة كل من امتلكه، ويكبر شكله بطول الاحتفاظ به. من شام AI.",
    image: `${SITE_URL}/api/img/collection.svg`,
    external_url: SITE_URL,
    social_links: [],
  });
}
