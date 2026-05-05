import { createClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config.js";

export function createSupabaseAdmin(config: AppConfig) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
