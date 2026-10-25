// Node-only half of instrumentation.ts (kept in its own file so the Edge bundle never sees crypto or Prisma).
import { reportError } from "@/lib/errorLog";

export async function report(err: unknown, request: { path?: string; method?: string }, context: { routePath?: string; routeType?: string }) {
  await reportError(`${context?.routeType ?? "request"}:${context?.routePath ?? request?.path ?? "?"}`, err, { method: request?.method, path: (request?.path ?? "").split("?")[0] });
}

// Self-hosted server only (Oracle): a minute after every start the owner's conversation start (system text + the fixed tool list) is read into its Studio's cache while nobody waits,
// so the first request after a deploy is not the one that pays for it. Vercel never does this (each serverless start would send a request). CODER_BOOT_WARM=0 turns it off.
export function bootWarm(): void {
  if ((process.env.CODER_BOOT_WARM || "").trim() === "0") return;
  void (async () => {
    const { runtime } = await import("@/lib/coderRuntime");
    if (runtime() !== "node") return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { ownerIds } = await import("@/lib/coderAuth");
          const { prewarmChat } = await import("@/lib/coderSections");
          for (const id of ownerIds()) await prewarmChat(Number(id));
        } catch (e) {
          console.warn("[coder-boot-warm]", String((e as Error)?.message || e).slice(0, 160));
        }
      })();
    }, 60000);
    timer.unref?.();
  })();
}
