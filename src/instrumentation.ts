// Next.js calls onRequestError for every error thrown while serving a route or page; it is sent to the site's error log (src/lib/errorLog.ts).
export async function onRequestError(err: unknown, request: { path?: string; method?: string }, context: { routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/errorLog");
  await reportError(`${context?.routeType ?? "request"}:${context?.routePath ?? request?.path ?? "?"}`, err, { method: request?.method, path: (request?.path ?? "").split("?")[0] });
}
