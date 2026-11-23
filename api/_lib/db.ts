import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.js";

let client: SupabaseClient | null = null;

/** Service-role client. Never expose this key to the browser. */
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, "Orbit's database is not configured on the server.");
  client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
}

/** Throws a 500 for a failed query and logs the detail server-side only. */
export function check<T>(result: { data: T; error: unknown }, what: string): T {
  if (result.error) {
    console.error(`Database error: ${what}.`, result.error);
    throw new HttpError(500, `Could not ${what}.`);
  }
  return result.data;
}
