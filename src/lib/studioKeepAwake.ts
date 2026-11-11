// Keeps every model's OWN Studios awake from the always-on self-hosted server (Oracle).
// 2026-11-11 (measured): the GitHub keep-warm cron is "*/10" but GitHub ran it about every 2 hours, so Studios fell asleep and the next user paid
// the cold start (Nova image 129 s, Sham v2 image 155 s; 12-14 s when warm). Each model's Studios are pinged separately (no shared Studio):
// a Running Studio gets a light GET; a sleeping/stopped one is woken with POST /deploy (a plain GET does not wake it). STUDIO_KEEP_AWAKE=0 turns it off.

const MS = "https://www.modelscope.cn";
export const KEEP_AWAKE_MS = 8 * 60_000;

const ENV_KEYS = [
  "OPEN_CODER_STUDIO_URL", "OPEN_CODER_STUDIO_URLS", "NOVA_IMAGE_STUDIO_URL", "NOVA_MEDIA_STUDIO_URL",      // Nova
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

export function startKeepAwake(): void {
  if ((process.env.STUDIO_KEEP_AWAKE || "").trim() === "0") return;
  const tick = () => { void keepAwakeOnce().catch(() => undefined); };
  const first = setTimeout(tick, 90_000);
  first.unref?.();
  const timer = setInterval(tick, KEEP_AWAKE_MS);
  timer.unref?.();
}
