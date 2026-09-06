import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();

  const users = await prisma.novaUser.findMany({
    where: q
      ? {
          OR: [
            { telegramId: { contains: q } },
            { email: { contains: q, mode: "insensitive" } },
            { apiKey: { contains: q } },
            { id: q },
          ],
        }
      : undefined,
    orderBy: { created_at: "desc" },
    take: 50,
  });

  return NextResponse.json({ users });
}
