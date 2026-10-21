// Platform adapter for the coder (owner's decision 2026-10-21: portable off Vercel). Nothing in the coder depends on a Vercel-only API
// directly; it goes through here:
//   later(fn)   background work after the HTTP response. Vercel: next/server after() (keeps the function alive). Self-hosted Node
//               (CODER_RUNTIME=node, e.g. the Oracle VM bundle in deploy/oracle): the process is long-lived, so the work just runs.
//   ticks       the scheduler tick is an HTTP endpoint (/api/coder/schedules/tick) called by any clock: GitHub Actions (*/5, free on a
//               public repo), the `ticker` service of the Oracle docker-compose, or a system cron. No Vercel Cron.
//   sandbox     src/lib/coderSandbox.ts backends: Vercel Sandbox or the self-hosted runner (SANDBOX_BACKEND).
export const runtime = (): "vercel" | "node" => ((process.env.CODER_RUNTIME || (process.env.VERCEL ? "vercel" : "node")).trim().toLowerCase() === "vercel" ? "vercel" : "node");

const inflight = new Set<Promise<unknown>>();
/** Background work after the response. Errors are swallowed (logged): it never breaks the request that started it. */
export function later(fn: () => Promise<unknown>): void {
  if (runtime() === "vercel") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { after } = require("next/server") as typeof import("next/server");
      after(fn);
      return;
    } catch {
      /* outside a request scope (tests, scripts): run it directly below */
    }
  }
  const p = fn().catch((e) => console.warn("[coder-later]", String((e as Error)?.message || e).slice(0, 200)));
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
}
/** Self-hosted: wait for background work on shutdown (SIGTERM) so a deploy does not cut a task step in half. */
export const drainLater = (ms = 25000) => Promise.race([Promise.allSettled([...inflight]), new Promise((r) => setTimeout(r, ms))]);
