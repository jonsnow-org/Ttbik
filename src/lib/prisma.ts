import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// The DB pool is limited to 15 sessions in session mode. Serverless instances multiply quickly,
// so force a low per-instance connection limit unless an explicit operator override is supplied.
// A short pool timeout fails fast enough for the app to show a retryable error instead of hanging until Vercel kills the request.
function pooledUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    u.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT || "1");
    u.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT || "8");
    return u.toString();
  } catch {
    return url;
  }
}

const url = pooledUrl(process.env.DATABASE_URL);
export const prisma = globalForPrisma.prisma ?? new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

// one client per process in production too (route bundles must not each open their own pool)
globalForPrisma.prisma = prisma;
