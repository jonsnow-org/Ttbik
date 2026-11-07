// How the site connects to the database. Pure (no secrets are read or stored here): it only reshapes the URL the environment already holds.
//
// Why: Supabase's pooler on port 5432 is SESSION mode. Every serverless instance (Vercel lambdas, one per concurrent request, kept warm and idle for minutes),
// every Oracle container and every maintenance script holds one of only 15 pooler sessions for as long as it stays connected, so "max clients reached in session
// mode" (EMAXCONNSESSION) happens with a handful of bots and cron calls and NO customers at all (2026-10-18 and 2026-11-03). The same pooler host on port 6543
// is TRANSACTION mode: a connection is lent for one query/transaction and handed back, so hundreds of instances share the 15 backend connections.
// Prisma needs `pgbouncer=true` there (no prepared statements). Interactive `$transaction` blocks still run on one connection, so they are safe.
// Opt out with PRISMA_SESSION_MODE=1. Direct (non-pooler) hosts and URLs that already say 6543 are left as they are.
export function dbUrl(url: string | undefined, env: Record<string, string | undefined> = process.env): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const pooler = u.hostname.endsWith(".pooler.supabase.com");
    if (pooler && (u.port === "" || u.port === "5432") && env.PRISMA_SESSION_MODE !== "1") {
      u.port = "6543";
      if (!u.searchParams.has("pgbouncer")) u.searchParams.set("pgbouncer", "true");
    }
    if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", env.PRISMA_CONNECTION_LIMIT || "1");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "20");
    return u.toString();
  } catch {
    return url;
  }
}
