// Next.js calls onRequestError for every error thrown while serving a route or page; it is sent to the site's error log (src/lib/errorLog.ts).
export async function onRequestError(err: unknown, request: { path?: string; method?: string }, context: { routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { report } = await import("./instrumentation-node");
    await report(err, request, context);
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootWarm } = await import("./instrumentation-node");
    bootWarm();
  }
}
