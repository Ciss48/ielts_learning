import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user for the current request, or null. Server-side only. */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
