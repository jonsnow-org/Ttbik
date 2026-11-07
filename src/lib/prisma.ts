import { PrismaClient } from "@prisma/client";
import { dbUrl } from "./dbUrl";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Connection URL shaping (transaction-mode pooler, one connection per instance): see src/lib/dbUrl.ts for why.
const url = dbUrl(process.env.DATABASE_URL);
export const prisma = globalForPrisma.prisma ?? new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

// one client per process in production too (route bundles must not each open their own pool)
globalForPrisma.prisma = prisma;
