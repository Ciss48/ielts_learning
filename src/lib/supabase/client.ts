import { createBrowserClient } from "@supabase/ssr";
import { config } from "@/lib/config";

/** Supabase client for use in client components (anon key, RLS-scoped). */
export function createClient() {
  return createBrowserClient(config.supabaseUrl, config.supabaseAnonKey);
}
