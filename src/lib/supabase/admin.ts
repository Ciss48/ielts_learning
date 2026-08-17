import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";

/**
 * Service-role Supabase client — bypasses RLS. Server / scripts only.
 * Never import this from a client component: the service-role key must never
 * reach the browser bundle.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "supabase/admin.ts is server-only and must never be imported client-side.",
    );
  }
  if (!config.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local");
  }

  return createSupabaseClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
