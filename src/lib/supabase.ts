import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) {
    throw new Error(
      `Missing ${name}. Set it in Vercel → Settings → Environment Variables (Production + Preview).`,
    );
  }
  return v;
}

/** Public client — safe to use in client components. Respects RLS. */
export function supabasePublic(): SupabaseClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, anonKey);
}

/**
 * Server-side reads of public catalog data (categories/services). Tries the
 * anon client first; if the anon key is missing or lacks a table GRANT the
 * query errors, and the storefront used to silently render empty (every
 * /service/* page 404'd, so no paid order could be placed). Falls back to
 * the service-role client in that case. Server components/routes only.
 */
export async function readCatalog<T>(
  query: (db: SupabaseClient) => PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T | null> {
  try {
    const { data, error } = await query(supabasePublic());
    if (!error && data !== null && !(Array.isArray(data) && data.length === 0)) return data;
  } catch {
    // missing anon env — try the admin client below
  }
  try {
    const { data, error } = await query(supabaseAdmin());
    return error ? null : data;
  } catch {
    return null;
  }
}

/**
 * Admin client — server-only, bypasses RLS via the service role key.
 * Never import this file from a "use client" component.
 */
export function supabaseAdmin(): SupabaseClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
