// lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

if (process.env.NODE_ENV === "production" && (!supabaseUrl || !supabaseAnonKey)) {
  throw new Error(
    "Missing Supabase env vars in production. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel (Production) and redeploy."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,

    // Avoid callback URL session detection on admin dashboard routes
    detectSessionInUrl: false,

    // Make the storage key stable across reloads/builds
    storageKey: "snapwin-admin-auth",
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
