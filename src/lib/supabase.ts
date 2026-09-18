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
