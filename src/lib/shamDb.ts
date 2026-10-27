// Sham's own database handle (same shape as the other modules' Db, its own object): Sham's tables are created and used through this one.
import { prisma } from "@/lib/prisma";

export type Db = { exec: (sql: string, ...args: unknown[]) => Promise<unknown>; query: <T>(sql: string, ...args: unknown[]) => Promise<T[]> };
export const prismaDb: Db = {
  exec: (sql, ...args) => prisma.$executeRawUnsafe(sql, ...args),
  query: <T,>(sql: string, ...args: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...args),
};
