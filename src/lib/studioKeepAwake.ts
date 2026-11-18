// Keeps every model's OWN Studios awake from the always-on self-hosted server (Oracle).
// 2026-11-11 (measured): the GitHub keep-warm cron is "*/10" but GitHub ran it about every 2 hours, so Studios fell asleep and the next user paid
// the cold start (Nova image 129 s, Sham v2 image 155 s; 12-14 s when warm). Each model's Studios are pinged separately (no shared Studio):
// a Running Studio gets a light GET; a sleeping/stopped one is woken with POST /deploy (a plain GET does not wake it). STUDIO_KEEP_AWAKE=0 turns it off.

const MS = "https://www.modelscope.cn";
export const KEEP_AWAKE_MS = 8 * 60_000;

const ENV_KEYS = [
  "OPEN_CODER_STUDIO_URL", "OPEN_CODER_STUDIO_URLS", "NOVA_IMAGE_STUDIO_URL", "NOVA_MEDIA_STUDIO_URL",      // Nova
  "NOVA2_COMPUTER_STUDIO_URL", "NOVA2_MEDIA_STUDIO_URL",                                                    // Nova 2, own services only
  "LFM_STUDIO_URL", "LFM_STUDIO_URLS", "LFM_MEDIA_STUDIO_URL",                                              // LFM2.5
  "SHAM_V2_URL",                                                                                              // Sham v2 (own chat + internal media)
];

/** "https://studio-<owner>-<name>.api-inference.modelscope.net" -> { owner, name, url }; other hosts are ignored. */
export function parseStudioUrl(raw: string): { owner: string; name: string; url: string } | null {
  const m = /^https:\/\/studio-([a-z0-9]+)-([a-z0-9][a-z0-9_.-]*)\.api-inference\.modelscope\.net\/?$/i.exec(raw.trim());
  return m ? { owner: m[1], name: m[2], url: raw.trim().replace(/\/$/, "") } : null;
}

// the code's own defaults (used when the env names are unset): Nova chat + image + media, LFM chat + media, Sham v2, and the computer hub
const DEFAULTS = ["coder-inference-server", "epicrealism-image-test", "nova-media-server", "lfm25-inference-server", "lfm25-media-server", "sham-v2-server",
  "nova-inference-server"].map((n) => `https://studio-novaai2026-${n}.api-inference.modelscope.net`);

export function studiosToKeepAwake(env: Record<string, string | undefined> = process.env) {
  const seen = new Map<string, { owner: string; name: string; url: string }>();
  for (const part of [...DEFAULTS, ...ENV_KEYS.flatMap((k) => (env[k] || "").split(","))]) {
    const s = part.trim() ? parseStudioUrl(part) : null;
    if (s) seen.set(`${s.owner}/${s.name}`, s);
  }
  return [...seen.values()];
}

export async function keepAwakeOnce(fetchFn: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  const token = env.MODELSCOPE_API_TOKEN || env.MODELSCOPE_TOKEN || "";
  const out: Record<string, string> = {};
  if (!token) return out;
  const head = { Authorization: `Bearer ${token}` };
  for (const s of studiosToKeepAwake(env)) {
    try {
      const r = await fetchFn(`${MS}/openapi/v1/studios/${s.owner}/${s.name}`, { headers: head, signal: AbortSignal.timeout(15_000) });
      const d: any = r.ok ? await r.json().catch(() => ({})) : {};
      const data = d?.data || d?.Data || d || {};
      const status = String(data?.runtime?.status || data?.status || "");
      if (/sleep|stop/i.test(status)) {
        await fetchFn(`${MS}/openapi/v1/studios/${s.owner}/${s.name}/deploy`, { method: "POST", headers: head, signal: AbortSignal.timeout(20_000) });
        out[s.name] = `woken (${status})`;
      } else {
        const g = await fetchFn(`${s.url}/`, { headers: head, signal: AbortSignal.timeout(20_000) });
        out[s.name] = `${status || "?"} ${g.status}`;
      }
    } catch (e) {
      out[s.name] = `error ${String((e as Error)?.name || e).slice(0, 40)}`;
    }
  }
  return out;
}

/** "https://studio-<owner>-<name>.api-inference.modelscope.ai" (the international site) -> { owner, name, url }. */
export function parseAiStudioUrl(raw: string): { owner: string; name: string; url: string } | null {
  const m = /^https:\/\/studio-([a-z0-9]+)-([a-z0-9][a-z0-9_.-]*)\.api-inference\.modelscope\.ai\/?$/i.exec(raw.trim());
  return m ? { owner: m[1], name: m[2], url: raw.trim().replace(/\/$/, "") } : null;
}

/** Nova 2's own Studio lives on the international site (modelscope.ai) with its own token; the GitHub cron that wakes it ran only every ~2 h (2026-11-18), and a Studio that
 *  sleeps comes back with a NEW disk: the 12 GB model downloaded again and nothing held in its cache. Same rule as above: GET when running, POST /deploy only when sleeping. */
export async function keepNova2AwakeOnce(urls: string[], token: string, fetchFn: typeof fetch = fetch): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!token) return out;
  const head = { Authorization: `Bearer ${token}` };
  for (const s of urls.map(parseAiStudioUrl).filter((x): x is NonNullable<typeof x> => Boolean(x))) {
    try {
      const r = await fetchFn(`https://www.modelscope.ai/openapi/v1/studios/${s.owner}/${s.name}`, { headers: head, signal: AbortSignal.timeout(15_000) });
      const d: any = r.ok ? await r.json().catch(() => ({})) : {};
      const data = d?.data || d?.Data || d || {};
      const status = String(data?.runtime?.status || data?.status || "");
      if (/sleep|stop/i.test(status)) {
        await fetchFn(`https://www.modelscope.ai/openapi/v1/studios/${s.owner}/${s.name}/deploy`, { method: "POST", headers: head, signal: AbortSignal.timeout(20_000) });
        out[s.name] = `woken (${status})`;
      } else {
        const g = await fetchFn(`${s.url}/`, { headers: head, signal: AbortSignal.timeout(20_000) });
        out[s.name] = `${status || "?"} ${g.status}`;
      }
    } catch (e) {
      out[s.name] = `error ${String((e as Error)?.name || e).slice(0, 40)}`;
    }
  }
  return out;
}

async function nova2Tick(): Promise<void> {
  const { nova2Urls, tokenForAsync, NOVA2_DEFAULT } = await import("@/lib/openCoderStudio");
  const urls = [...new Set([...nova2Urls(), process.env.NOVA2_COMPUTER_STUDIO_URL || "", process.env.NOVA2_MEDIA_STUDIO_URL || ""].filter(Boolean))];
  if (!urls.length) return;
  await keepNova2AwakeOnce(urls, await tokenForAsync(nova2Urls()[0] || urls[0] || NOVA2_DEFAULT));
}

/** After the wake-up: every Nova Studio holds the start texts ready (a Studio that holds them answers at once; one that restarted reads them while idle). */
async function warmTick(): Promise<void> {
  const { warmNovaStarts } = await import("@/lib/coderSections");
  const r = await warmNovaStarts();
  const cold = Object.entries(r).flatMap(([k, v]) => Object.entries(v).filter(([, t]) => t === "warming").map(([b]) => `${k}@${b}`));
  if (cold.length) console.log("[nova-start-warm] warming", cold.join(", ").slice(0, 400));
}

export function startKeepAwake(): void {
  if ((process.env.STUDIO_KEEP_AWAKE || "").trim() === "0") return;
  const tick = () => {
    void keepAwakeOnce().catch(() => undefined);
    void nova2Tick().catch(() => undefined).then(() => warmTick()).catch(() => undefined);
  };
  const first = setTimeout(tick, 90_000);
  first.unref?.();
  const timer = setInterval(tick, KEEP_AWAKE_MS);
  timer.unref?.();
}
