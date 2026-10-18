// Node-only half of instrumentation.ts (kept in its own file so the Edge bundle never sees crypto or Prisma).
import { reportError } from "@/lib/errorLog";

export async function report(err: unknown, request: { path?: string; method?: string }, context: { routePath?: string; routeType?: string }) {
  await reportError(`${context?.routeType ?? "request"}:${context?.routePath ?? request?.path ?? "?"}`, err, { method: request?.method, path: (request?.path ?? "").split("?")[0] });
}
