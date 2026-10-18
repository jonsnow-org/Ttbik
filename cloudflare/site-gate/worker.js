// (build trigger 2026-10-18: first Git-connected deploy of the gate)
// Cloudflare Worker "ttbik-gate": the one permanent public address of the site, the bots' webhooks and the mini apps.
// It forwards every request to the PRIMARY server (Oracle) and, when that is down, to the STANDBY (Vercel). Telegram, TonConnect and every
// link point at the gate's own address, so switching servers never means re-registering webhooks or changing links.
//
//   mode (kept in KV key "mode"):  auto = Oracle first, Vercel when Oracle is down (default)  |  oracle = Oracle only  |  vercel = Vercel only
//   a pinned mode ("oracle"/"vercel") lasts PIN_HOURS and then returns to auto by itself.
// NO SECRET lives here. A mode change is authorised by our own database: the owner's bot creates a one-time nonce, then asks the gate to
// apply it; the gate asks the servers (/api/ops/gate-verify) whether that nonce is valid and what it allows. Nobody else can create one.
// Settings: KV binding GATE (wrangler.jsonc) and optional variables PRIMARY_ORIGIN, SECONDARY_ORIGIN; optional secret GATE_KEY (the page /__gate).
// Free-plan facts: 100,000 requests a day for the whole account, 10 ms CPU each (this code uses about 1 ms; waiting for the origin is free).

const DEFAULT_PRIMARY = "https://89-168-89-15.sslip.io";
const DEFAULT_SECONDARY = "https://ttbik.vercel.app";
const MODES = ["auto", "oracle", "vercel"];
const DOWN_MS = 30_000;                 // after a failure, the primary is skipped for this long, then tried again
const MODE_TTL_MS = 15_000;             // each server instance re-reads the mode from KV at most this often
const BUFFER_LIMIT = 5 * 1024 * 1024;   // request bodies up to this size can be replayed on the standby
const PIN_HOURS = 12;                   // a pinned mode returns to auto after this long
const STREAM_PATHS = ["/api/media-stream"];
const state = { mode: "auto", until: 0, modeAt: 0, downUntil: 0 };

const enc = new TextEncoder();
function safeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const origins = (env) => ({
  oracle: String(env.PRIMARY_ORIGIN || DEFAULT_PRIMARY).replace(/\/$/, ""),
  vercel: String(env.SECONDARY_ORIGIN || DEFAULT_SECONDARY).replace(/\/$/, ""),
});

export async function getMode(env, now = Date.now()) {
  if (now - state.modeAt >= MODE_TTL_MS) {
    let m = "auto", until = 0;
    try {
      if (env.GATE) { const v = await env.GATE.get("mode"); if (MODES.includes(v)) m = v; until = Number(await env.GATE.get("until")) || 0; }
    } catch { m = state.mode; until = state.until; }
    state.mode = m; state.until = until; state.modeAt = now;
  }
  return state.mode !== "auto" && state.until && now > state.until ? "auto" : state.mode;
}

/** Which servers to try, in order. `down` = the primary failed less than DOWN_MS ago. */
export function plan(mode, down) {
  if (mode === "oracle") return ["oracle"];
  if (mode === "vercel") return ["vercel"];
  return down ? ["vercel", "oracle"] : ["oracle", "vercel"];
}

function forwardHeaders(request, gateHost, served, failover) {
  const h = new Headers(request.headers);
  for (const k of [...h.keys()]) if (k.startsWith("cf-") || k.startsWith("x-gate")) h.delete(k);
  h.delete("host");
  h.set("x-forwarded-host", gateHost);
  h.set("x-forwarded-proto", "https");
  h.set("x-gate", "1");
  h.set("x-gate-served", served);
  if (failover) h.set("x-gate-failover", "1");   // the standby tells the owner (it holds the bot tokens), the gate holds none
  return h;
}

async function callOrigin(base, request, body, gateHost, timeoutMs, extra, served, failover) {
  const u = new URL(request.url);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const init = { method: request.method, headers: forwardHeaders(request, gateHost, served, failover), redirect: "manual", signal: ctl.signal, ...(extra || {}) };
    if (body !== undefined && request.method !== "GET" && request.method !== "HEAD") init.body = body;
    return await fetch(base + u.pathname + u.search, init);
  } finally { clearTimeout(timer); }
}

function finish(resp, name, bases, gateOrigin) {
  const h = new Headers(resp.headers);
  const loc = h.get("location");
  if (loc) for (const b of Object.values(bases)) if (loc.startsWith(b)) { h.set("location", gateOrigin + loc.slice(b.length)); break; }
  h.set("x-gate-origin", name);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}


// ---------- the ZNBt coin icon: it is written into the coin on-chain forever, so it must never fail ----------
// A fresh copy is served at once (wallets ask a lot); otherwise a server is asked; if every server is down the last good copy is served (up to
// 30 days); if there is none, a small copy of the coin that lives inside this file. The picture is image/webp.
const ICON_PATH = "/api/zenobia/znbt/icon";
const ICON_FRESH_S = 600, ICON_KEEP_S = 30 * 24 * 3600;
const ICON_FALLBACK_B64 = "UklGRmAWAABXRUJQVlA4IFQWAABwUACdASqgAKAAPrFCmEqnI6InNrtNyOAWCWIAwvB8LDeeCPvmnyikDYKHmed/8n35fSruCeeXvKi8R5QrU/Vb+J/e/RLyn9n+pB3d44eAfy71CPavngfZdz7bf0BfdT7x4KOr14d82H1F8HKgJ+qfVp/z/JP9a+wZ5dPVDMif92nsmffGooWPQGEHC56cBjd/IeHirFHl2GpvOkDnwNbklwQriJrweJyjeiY7DxZpxi1CSxbyrF7v2+j5YayjMHJW0xVJiuwcEKhf06ujP7gm+61oyw7u/KEya+bZXRxZ9PMYJUi+4a+3mnSHcZ05uvIOR87kQlsgXXyyQHVsSh6J1xXCSxPrjwytmJ3LyUeFzlQokWJSQ67gIfhOdfSjaLaJcnG4FW8eqwICCuwSEkCoXU3D2zuAi3nXiRRyAanDE679sY6HHKR5rt+iPzLI5aUVTmI+L2EWXvlnaxJXXDeCcNndKt/HnGOhZfdBbJwJJFan+5PKA8+nOET+s1Cax0WWTZgqz1m50T1am85qQdrDs1xRDnqGmaLZTiqwQMhx5KAGWpftsOUKfU0v9Qt6aeVk7cwzRPagW20xK0nYny3wA2Fqeh7HUMXKyqTavhUsOX3oyaMwD0yi5LCwQESChCQ4c6mxO8YUs33+n8BtAXyN487+z8uHRZeWVvO3CMQeKgn28GFmj3IfhNuXfbbpRbSUrdh3OMLt7JXP3Fi04K29w5++UR6tn8SfTOYqZ0X+jD7b5cOcFlQAdNBQ0nircYqs3D5EzSCIvzC/86PlFIiBLffwKHB2RhudPUNVLf/uWtyj2hgH9O8Lrq7526G9fADbwAzLY60L9trp+YeaQJrzyM/6NPbFKqEstA4AAP70f7RyGYtGbgDP9UM6fhH3iuc2dldss6YLvw2jOBB/0xp6Uv9wiXSgHYvSS5W0yerlgrvwKYbOsNK5LZ67zT2PpQIt+DF063L8N1TM/6p+Ti0d/S6nMxwsWLJ/Q9JPxiGrPiagSV3hInysLq4uOSlNCGg5gB8MBcRwqJsni9jqNUb+3K7gIg9oyrVTqiUFgDFuts6c3od9QVZ/Vdbtdi3CIkcP19tZbhemqrtMyo9oRmPGN7PxxG28NOIlBobDYUUXm/Dx4HisVI6K7PTGgOl/0z8/8fvibpDL1myBWXcrmj4R8L2hpi2g13kjC093fa2KFd9p+uk5lCe5Lo2V/24g3+hundyfzPHpTrE2f61UrWBUdTnGww05oidL44HpbFhMkAEM+C9ZTgRhUuTf2dGtm3B7iDdcuKRzxFoBjMjJQ5nRFovDFFBvqnRXNKok67kwSRaOd+3h38+2qQ+b86JgIr1j3ZfTHooxhA/0WUaVhXEwQCegUTsYBE16IcxWOo+AW0RE5CJY9lKt1skBwSjcRlj0Gl8hLXJbTHA7GOXYtAkEYgxDJCFOSCLqoRxABoB/5eKuX5sI1Itb/P7PInOkILuEU2/r4BYeglc5o5R7A0x3tzvsaVbQ0LHerZVLSu5uVNN+2zzp5DkqiuLtqvhe0t5ZY6dYVBjY4PINlqzZLXKjGRWX+Wawzi9MQ/9QZNbFyqmgtngqTm07G/swtsFfrs4twbDWdtz4h1kL7Jr4RC5HptqLqyVZFGeICYY/ArqTa+F/rZp9WSFoFfpS+RxnC2eWzgfPevv/lzCnqa45sQnaQgI91ehJ1vpbN5833whvNIQ2a5jgdaQOa0UtuO0cVtFSrXiqOaoCGUWz1dV2Dur2CWZJFq9teUMvQ5dhPC3Vb9UzaL6C/xoK+JhwTakiWmnsjxKYINx3m1/xYICDucYpC8GEGAcyR7sTTbUPVCfUfFJLUD6EXiQeO6Y3qRUuiEzJY7P9G9D0elKyb562eqSg0cD1agELC6lDAToWo0d3fqTUfgVJw/chyO3xsDV66ZzQgpvcMgrJidr5d/cAzbjx/vQOqH2dG4ljrV6Wvrwz/hjOlD9r1baPQAjGG32zwg5YcOa2sV3lbmZpDP9ZOWMV+nq7ATiBJIo3fnU6DhaX9s9le60QAkp4RER2pThyql5iEBODv5oapWv5j0aBT0Ld8X4Gkwz1LoIpQymNeIqbDe9brHn2KweDaSGQKijoaEnR3QvTQKz1sjXgCsXzVnTlYQYaRXreKTTAiUOj5J9pKYy+nVht/mn6KPAAgVx3lm8hPFkOQGwg/H0DWhwUfnNfGCDIc2xoJJVsWsIj5g22D917h58OJ7KBaYu/kVYx+BqLnRoJdkNIQy0dnGVJU2mJxv2kci+UgYCG+gfPHQjX3VGUc4OSBKCZG711V420j+azY9SFDnLVqjawoR6Ume6/H37v7yKlEUBbj86xgnpJem692PNPjQ/itA2OpzIdWj0hdTHIUUixA7zdsycuoSVLDnRZoJmkyG/xQnAjyi2mzLgc19GXUkOd0IOpmdwxYZqQxusJRLNP7pKPECy06t3OHO1AfPAdLRUNDJDM+kOS9tAUVfftFPP6717GFwZWAsI6BFrrYWalMru0Y9RHrnyKYmJ+oV+TIZaKljXhmBZPHL/9CNj0+eMKbdC6JaemUHZS2HVrYoV8JuDlhhsGYDN5a81wPXbdOSdt2vVYOdTFFYdk/j228+Ls8v7y0ElmJruMUp/bG0uyfUpLsG2l6ImxHC+Pl0gMzPp3wxkEYNATUdP2a7gP3lz43oeO1ptyc3+3RZE28X8F9XGQolkG2OQfRMAT9jrRoyoB1L9VNNd5Jf07lsChSieZSgiXI0dq8LN68MN/YU+0H1fxDa4Qac5Q5t43YXRHa1z7H9OILFo13ImHz9W9bOiD2a4pDcBQLvE7fYmFEZVho6HCf8DJIDu1mgalf1iunU8y1SRjGbG0zG8DA4RGje4jQ+qhefgJGC+8v3UXtNjIinrvLWzot8v+2y7HwZuZTvKbW75sgS2hAt0e3QxYRsMSHmDCvEjZ7TcJIseRyhEvCjRR6PpIiaWGIuOXcSpOD4JqwEiovUECLkrsv/SSBsWTgAWQoniuurvh77SxyTI7a+a/qU/bSNDO5NxXE1hLdJzNU3a8YUJqi4BPIx5wmRjZS0EBSJnxRJchJ0Gw8IlueZgllCwu7gxQ1AfQLFEbYuuZnTb+9NsappwZWkJh5ah593Zjz6O0GXMRrkqYSvZ3ThjBKfbxutAapz/oQiwMmDzXGP4CDA+1XiZxzxW5NAlfdUEMchnio2yBIsM28C1HOlBqxwGhJm6RTZKruu1c02sNHXVKZ3tRhvlfn6Caol7swkGDg4kryYJtzns9U/bDxrgk0uWGZkA8mYrXTy2MZ3DbWASDLY1huCoBSA1YsYBZZFiBMfXUSSWRFbfxFLh2WV2ywyL0B2rVk7U1vLTK4HMsaEjV1euQHofWYI1Bxm6/j4utwn++966W9x/vmEyasZsglRGAIZqYoTi6Xqx3o60eXQNNGwP9Jp0+g6HdUAKbvc2B1q/nNC/hF8C2Z7PbUA5KJt1SIKtXGR21lV4Ola72S+qxnoLXm1OADfVvurO3Okp8jjVLlr79YMyI6RMgcvS3dNxuJx/1ntSircEfRFuEnA3Xm60/knjJOfdUlBAl0JPy5Wygg/VMl+5rugEDs8iPjid0p05+/5HRXAnnMf27Ceg6HMRcj/sZuFv4umOt+N4a6KK/mjRkb/H5BzyiYAUBzBU0CJrDeejHnfbA+oAql7eA6NeZOPiCr0gpyCqqhCLbuL+wvANDhQKr4Xi+ClFZ3D5skccBvTAtrtAb213r73/mRCChowdRKzey044W/OQ4P+WxItylmWo5UAyQZVSnPE3YplZK2fpflz78HQeo8/osdbX4y2mqjw3IT5UnpIr/d3Q+hBjweugnRxeBDdktnZF+QwTGcBjqa4LWSlNHSW6+NuQjigfTqTq7sxB1yt9LONJBV+WYNtgQob5Tz5QFKBa0JE9CCTvIOn6YXBFN84JsDOFe0REyvi6d410xBhysHU+3cTnb4DmAE0e/3HxTv9r4mr47uQl9PiAIf7HIMCXXhixPqxJ9douniwm7hI3Xorx8PlUF3fzO3LuoFhnMy6887RztNlUwqO1aIJpH1quT2pQjEgiNrm1be5D/drbPxN4wBydkfueKeqhCol0BkeOr1oVrBWuuNu3WLZ3b2dCG9uou8I/VNwfWgkBxAhrTrqxSvo9YB6UUGBre3FY8du0V+YVjUeU8DppZYzF43Hndb1wsUBm8FjBM8N95wUif8LVSb/9/eppjfZ/vWpHfNvxtPL+uMyrkjPJGsRz2nqarde9owPwphzKZexkHwAHM42qA+mBzC2yJEfPHGvxsM3uJM5LFoPTsjP24YwTp7uyGA5pK2OBCRdzsqv9x47fasCAtcmSODP/rVSZeL1Na2uTP/zr1Z4wf/M43j7KgtvCvxQnmzjv7rcABiqDnRWD0IhDuHyD567eOjjJgBMT3SJAFQjXWPFGGyVQU95WoPi7fmW5uWdmmzkCs0CCJGuRHnYYe/wHYmANuts2nz/f7v/6qSVhWKQ5fF/V21/jlJym1+U8p/F8q5XHf4FuoJX7weSBvilISXUtzCePNSQq/3KTMohzSrjFzdfJOjAU55g5sfljMMuwGhEC6pjwVg1SsEfvkWykUYm6xFedWSmR4kc1xcValDwoQL0P9awvQqDTE3mXdq/867NpDwpljY5xtAjCst/3eW4aJlIF49t78OuNGKU7ZHFa29Sf/OBgtlxIcYkNwBRu5atAeUL6sWXjjkWfU7wmwVgHgfw82gVJTZYfA8wpNF8EkvzEGdbkc19BdFPKMRdot7Te+v3Lp81fJzrIE10IW7Z5S8xMRFRTF4slGmuDJ9v1UPLRqIeZxsZEXARxwTnTI4yVr6WyBN2uUyjl6X9O3kFaGZk7dBqXKRuj8QNRzm4VKE2ls09UVKJvQ/cj0VAYdvW1iVNOj2nd/5HgVNLPQrmskkTRVVZCA4g35hmGes8d+W8u67I+3DMXsx3rPYVApfXo0Wn6ZljS9BiZTh0lQzWyhfN1Ka6aXPW7C3L0rSFOFwuComsSAgmYm3/uxekeX5s7xzaEXbkiGcqUt/okyqDgJGSHiCoDJnPXXKfo9riG1VvYYC5HOZTK14lugRRa2JJ8zTO4dPgi/n7sEq4+HhIWcEZTGzFiVRNPRn7G5WJv6NTMtAc/yBbOZ+bFr44WXhWp4Bp5b9CeHz2DsAopbOdQWBmun/OnwLK8rvmcUHbSJ4eiU6Is+kuubwkmDUfIE1wWkWjqLLaNaENXg87Ki9keWssN7hXzYYcL7Z3K3naQ0/f5zuM3MlEFtn57D7Y243sCZkObdOUBybBXSmzNdADVBc79wPVeAjiyq1unjG4uC9YM4UZuD8c/vQ6tsW4aIcGBq2/Xho9SdNRVjXcQ7xKyXqUtFQyxLAHMilcmthMnOSqx3TB08Up5iWIkEdLsY4sbvMPio7cKbaBziWYgAbQTEv/vN7aKBNo8h9VfLplor9RMFZpz3wWrk33EvJ49KIpeLOMZI8+B2/XIK8ybAoKkFDKQLJa637H9zZukSBZQOXLPJfXQV3duSzVuDYSc+GdMcZCX9YlRw5WVpau4FKCEUbyIYeK0PQWKi2hShCYzLQ1WlozMHhh6eCPWJl4NpHadp8XLY3usbXA76bNUtFAYC/k13BMPcjUEEg2i4BW+pKc5NNGMKOR9CKZk2yA4TZZCSDg3HkaeQuS64MYUHupd8QyiJ+p2UZJ1ruvhxGRFqBeiZjG2361aorHftqNdm6xv9yrmHwKA2oYtvHbfuAkEu5g8Nu/VhFEODFaxoYgmJS1SneTh/yLeCoWrPLs0Sv+3ZLvtGQsSkVd40C28iqv+LQoFePQiNV8iAK+PpdZKv8ZCoACvpTbbCN9qIV8RiuwcstMTeRWq1dk8xiDDOJgzlIuEQUn5nA0P7pgmWAIwDlDyDBefXlpeQRT6VPHqe/U/0LIeI8UmXb2h4ZKg4uybrRdh6W1YQYUcR6DsJ15TUI2DZVkt1ckBsnvrqyduHLNPSwQmiIovcnr1gKHXU23rIdAoOXkaukjzp2DvDdlPb3xgheBX2IrncQsMeQsoZwAm7IzehuwmGlrH9qC+TWojFDuXfLXx+HKc03b6ZO2mvZ3JZX0TNyXfrJrVv3CDi4hqkJtXvZlEEpKPDYJDWM25FicGYBOVvkPcYd1R6tY5GmXC81w1MhHhL8rFRTdpr3sGXox6CMfys9OvCtHibEge6k/xZILzUzcbEAV9eU1pTdzJwUbI+e5HKDlZRCt1jih6/lCczT7b2Y/JEylcwafgcg0kL2SDWC4wYXHZsO8Qp3biV8yresIPr4fb+44GIBgxV+bdcg0nmeAsq/Npx+Ha6KxfSDafqy2EQTHo3G6wzLSZ6Wcnmn7/TSlI0vY6SyPGwHFqlipNgBVSRMd6BFsYIExOGb9c/VAxDwGw0w5eGVGgUwwfXvju6NpxjHzhhDiGNKiifbGp3gpTG5u2yi1Cer0GeNhA8jpdvGerEvedok0ItECdHyrIg1/kla6IfB8hJm/b6JcsmP0wrdQ26dCTdEboYoggjDlORR8Yy/bM5JT7UkLSlVT8lkF2nR6G9FMs9UnnnZcc/bwUd0FX0CU8Mrp7P9PjWvv1FwcVLm2VQ2tbFoobuYOR7ucgXHIdIKXG9ekXUQ1OBrDSjEz+ER89Xq+eT1/HwjpqAk93h7QE/CqNWR2ApszK3aIV4TffaTSc6tYz0JRtOeGrYq23eaVeQC3Gyv4PdCqMb8fv5SbyXpb7OxLvZbJhOFSZ3dusnrvP0vCWTNsl5XZjYf5PlxUWbV5hhz1hUZfXiGUfyWo9k2qAIS9Z2EIaEalMT3tcjlHXt+S6N5+OjrzL88TvDDG5CYIdpvVAQopRaYDaTrlMXWHB3uX3fdyXe9yjoT+LddKnc1xoIeSZGE2/FpWs0DJuTMrFYctmGIQCGkrMQdc+oXyF7iHtTop3G1Kg64Ob2WOr0UlUDbJccgS96Bwrw7kUkD8Pbibrr2dSAOzHzChXsEbr1mZke7Ps7cT88xM0j9w5ZnEvjs8MxAvZNBlvrYg8BgrJsCPwGnqiR0dqkNXnjr9Ms6/3B5BiU8UG/FkgAz5isC1cfSPw6mZPG1+DRV+ThHdYK1X6HXXdqNvYSpb+pufNN3VeR6rRKaIac3l6EZJHjsOvVsofsZFTxJiyBkkEoMPRRby8CBpqEn0W4an5ck5Hls4st+wQBCoY+HigKc/eglbcKrUpSKVN3nVQaJykhYasXspLMrG50q8dJqgoSRmOnUumTR8enD45vlixle2fvSV+sgM3joVc0pR26/fu4gW9ulMzwGO63FaR+WIGT4XlfEY/K/OgtRLjfWz6sV2hui/uUxNuDQfrpnkdlKjtAjCMK0Pd1KFagqoMOksKCPgCCK28B/6kzf7819s8v5no/xe11owKePXtFpScezYJeJLhkkv6HP7/NWW2Pc4bkSRkxz8/IwjSWpT2VGRj94UkXiUJWaNPVNhgAdX/NyjQEcFilxn/dOZUme+RqijJEhkM6XupPujgS5EnqKmXZyMEITwP6ooeJ+P+PGpKg+fC3Pd2giv5luilTD1LqUVVbKCcaFoANSy5bKxggLnjZU99uaEM2vtWC/HcPDfLM2AAA";
const iconKey = () => new Request("https://znbt-icon.invalid/icon");
function iconResponse(body, kind) {
  return new Response(body, { headers: { "content-type": "image/webp", "cache-control": "public, max-age=600", "access-control-allow-origin": "*", "x-gate-origin": kind } });
}
async function serveIcon(request, env, ctx) {
  const cache = caches.default, key = iconKey();
  const kept = await cache.match(key);
  const at = kept ? Number(kept.headers.get("x-kept-at") || 0) : 0;
  if (kept && at && Date.now() / 1000 - at < ICON_FRESH_S) return iconResponse(await kept.arrayBuffer(), "kept-fresh");
  const gate = new URL(request.url), bases = origins(env), mode = await getMode(env);
  for (const name of plan(mode === "auto" ? "auto" : mode, state.downUntil > Date.now())) {
    try {
      const r = await callOrigin(bases[name], new Request(request.url, { method: "GET" }), undefined, gate.host, 8000, undefined, name, false);
      if (r.ok && (r.headers.get("content-type") || "").includes("image")) {
        const body = await r.arrayBuffer();
        ctx.waitUntil(cache.put(key, new Response(body, { headers: { "content-type": "image/webp", "cache-control": `public, max-age=${ICON_KEEP_S}`, "x-kept-at": String(Math.floor(Date.now() / 1000)) } })));
        return iconResponse(body, name);
      }
    } catch { /* ask the next server */ }
  }
  if (kept) return iconResponse(await kept.arrayBuffer(), "kept-old");
  return iconResponse(Uint8Array.from(atob(ICON_FALLBACK_B64), (c) => c.charCodeAt(0)), "builtin");
}

async function proxy(request, env, ctx) {
  const gate = new URL(request.url), bases = origins(env);
  const mode = await getMode(env);
  const now = Date.now();
  const order = plan(mode, state.downUntil > now);
  const safe = request.method === "GET" || request.method === "HEAD";
  // video and audio are never carried through the gate (bandwidth, Range requests, Cloudflare's rules on streaming): the browser is sent straight to the active server
  if (safe && STREAM_PATHS.some((p) => gate.pathname.startsWith(p))) return Response.redirect(bases[order[0]] + gate.pathname + gate.search, 307);
  const isAsset = safe && gate.pathname.startsWith("/_next/static/");
  const len = Number(request.headers.get("content-length") || 0);
  let body;
  if (!safe) body = len > BUFFER_LIMIT ? request.body : await request.arrayBuffer();
  const replayable = safe || len <= BUFFER_LIMIT;
  let last = null;
  for (let i = 0; i < order.length; i++) {
    const name = order[i], more = i < order.length - 1 && replayable;
    const timeout = safe ? 20_000 : 50_000;
    try {
      const extra = isAsset ? { cf: { cacheEverything: true, cacheTtl: 31536000 } } : undefined;
      const r = await callOrigin(bases[name], request, body, gate.host, timeout, extra, name, name === "vercel" && mode === "auto" && state.downUntil > Date.now());
      // a static file the other build does not have (the two servers can be on different builds): ask the other server
      if (isAsset && r.status === 404 && more) { last = r; continue; }
      // the server answered but is down behind its proxy (Caddy answers 502/503/504 when the app is not running)
      if ([502, 503, 504].includes(r.status) && more) {
        if (name === "oracle" && mode === "auto") state.downUntil = Date.now() + DOWN_MS;
        last = r; continue;
      }
      return finish(r, name, bases, gate.origin);
    } catch (e) {
      const timedOut = e && e.name === "AbortError";
      // never replay a request that may already be running (a timeout on a write); a refused connection never reached the server
      if (more && (!timedOut || safe)) {
        if (name === "oracle" && mode === "auto") state.downUntil = Date.now() + DOWN_MS;
        continue;
      }
      return new Response("upstream unavailable", { status: timedOut ? 504 : 502, headers: { "x-gate-origin": name, "cache-control": "no-store" } });
    }
  }
  return last ? finish(last, "fallback", bases, gate.origin) : new Response("no upstream", { status: 502 });
}

// ---------- the switch page ----------
const PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Gate</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:520px;margin:0 auto;padding:16px;background:#0f1424;color:#eef}button,input{font:inherit;width:100%;box-sizing:border-box;padding:12px;margin:6px 0;border-radius:10px;border:1px solid #4a5688;background:#1b2340;color:#eef}button{cursor:pointer;font-weight:700}button.on{background:#2e7d32;border-color:#2e7d32}pre{background:#1b2340;padding:12px;border-radius:10px;white-space:pre-wrap;direction:ltr}</style></head><body>
<h1>البوابة · Gate</h1><div class="mut">التحويل من لوحة «الاستضافة» في بوت أثر. المفتاح اختياري (لمن يملك GATE_KEY). · Switch from the Hosting panel of the Athar bot; the key is optional.</div><pre id="s"></pre><input id="k" type="password" placeholder="مفتاح البوابة (اختياري) · gate key (optional)" autocomplete="off">
<button id="go">عرض الحالة الكاملة · Full status</button><div id="b" style="display:none"><button data-m="auto">تلقائي · Auto (Oracle ثم Vercel)</button><button data-m="oracle">Oracle فقط</button><button data-m="vercel">Vercel فقط (الاحتياطي)</button></div><pre id="o"></pre>
<script>
const $=id=>document.getElementById(id);const K='gate_key';$('k').value=sessionStorage.getItem(K)||'';
const call=async(p,o={})=>{const r=await fetch(p,{...o,headers:{'content-type':'application/json','x-gate-key':$('k').value}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j};
async function show(){try{sessionStorage.setItem(K,$('k').value);const s=await call('/__gate/status');$('o').textContent=JSON.stringify(s,null,2);$('b').style.display='block';document.querySelectorAll('[data-m]').forEach(b=>b.className=b.dataset.m===s.mode?'on':'')}catch(e){$('o').textContent='Error: '+e.message}}
$('go').onclick=show;document.querySelectorAll('[data-m]').forEach(b=>b.onclick=async()=>{try{await call('/__gate/mode',{method:'POST',body:JSON.stringify({mode:b.dataset.m})});await show()}catch(e){$('o').textContent='Error: '+e.message}});
fetch('/__gate/state').then(r=>r.json()).then(j=>{$('s').textContent=JSON.stringify(j,null,2)});if($('k').value)show();
</script></body></html>`;

async function probe(base, path) {
  const t0 = Date.now();
  try { const r = await fetch(base + path, { signal: AbortSignal.timeout(4000), redirect: "manual" }); return { ok: r.status < 500, status: r.status, ms: Date.now() - t0 }; }
  catch (e) { return { ok: false, status: 0, ms: Date.now() - t0 }; }
}

async function setMode(env, mode) {
  if (!env.GATE) throw new Error("KV binding GATE is missing");
  const until = mode === "auto" ? 0 : Date.now() + PIN_HOURS * 3600_000;
  await env.GATE.put("mode", mode);
  await env.GATE.put("until", String(until));
  state.mode = mode; state.until = until; state.modeAt = Date.now(); state.downUntil = 0;
  return until;
}

// Ask the servers whether this one-time nonce was created by the owner's bot (they consume it) and what it allows: "mode:auto|oracle|vercel".
async function verifyNonce(env, nonce) {
  const bases = origins(env);
  for (const name of ["oracle", "vercel"]) {
    try {
      const r = await fetch(`${bases[name]}/api/ops/gate-verify?nonce=${encodeURIComponent(nonce)}`, { signal: AbortSignal.timeout(6000), headers: { "x-gate": "verify" } });
      if (r.status >= 500) continue;           // that server is down: ask the other one (they share the database)
      const j = await r.json().catch(() => ({}));
      return j && j.ok && typeof j.action === "string" ? j.action : null;
    } catch { /* try the next server */ }
  }
  return null;
}

async function admin(request, env) {
  const u = new URL(request.url);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (u.pathname === "/__gate" || u.pathname === "/__gate/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  // public and harmless: which mode is active and which server is tried first
  if (u.pathname === "/__gate/state" && request.method === "GET") {
    state.modeAt = 0;
    const mode = await getMode(env);
    return json({ mode, until: state.until || 0, effective: plan(mode, state.downUntil > Date.now()), downUntil: state.downUntil || 0, kv: !!env.GATE });
  }
  // the owner's bot created a nonce in our database and asks the gate to apply it
  if (u.pathname === "/__gate/apply" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const nonce = String(b.nonce || "");
    if (!/^[0-9a-f]{32,64}$/.test(nonce)) return json({ error: "bad nonce" }, 400);
    const action = await verifyNonce(env, nonce);
    const m = /^mode:(auto|oracle|vercel)$/.exec(action || "");
    if (!m) return json({ error: "not authorised" }, 403);
    try { const until = await setMode(env, m[1]); return json({ ok: true, mode: m[1], until }); } catch (e) { return json({ error: String(e && e.message || e) }, 500); }
  }
  // optional extra control for someone holding the (optional) secret GATE_KEY
  if (!env.GATE_KEY || !safeEqual(request.headers.get("x-gate-key") || "", env.GATE_KEY)) return json({ error: "unauthorized" }, 401);
  if (u.pathname === "/__gate/status" && request.method === "GET") {
    state.modeAt = 0;
    const mode = await getMode(env), bases = origins(env);
    const [oracle, vercel] = await Promise.all([probe(bases.oracle, "/api/health"), probe(bases.vercel, "/api/health")]);
    return json({ mode, until: state.until || 0, effective: plan(mode, state.downUntil > Date.now()), oracle, vercel, origins: bases, kv: !!env.GATE });
  }
  if (u.pathname === "/__gate/mode" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!MODES.includes(b.mode)) return json({ error: "bad mode" }, 400);
    try { await setMode(env, b.mode); return json({ ok: true, mode: b.mode }); } catch (e) { return json({ error: String(e && e.message || e) }, 500); }
  }
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === "/__gate" || u.pathname.startsWith("/__gate/")) return admin(request, env);
    if (u.pathname === ICON_PATH && (request.method === "GET" || request.method === "HEAD")) return serveIcon(request, env, ctx);
    return proxy(request, env, ctx);
  },
};
export const _state = state;
