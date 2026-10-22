import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// The database pooler allows only a few sessions in total (EMAXCONNSESSION "max clients reached in session mode, pool_size 15" took the
// bots down on 2026-10-18). Vercel can run many serverless instances at once, so keep each instance to one DB connection by default; override with PRISMA_CONNECTION_LIMIT or DATABASE_URL only if the database pool has headroom.
function pooledUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT || "1");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "20");
    return u.toString();
  } catch {
    return url;
  }
}

const url = pooledUrl(process.env.DATABASE_URL);
export const prisma = globalForPrisma.prisma ?? new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

// one client per process in production too (route bundles must not each open their own pool)
globalForPrisma.prisma = prisma;
