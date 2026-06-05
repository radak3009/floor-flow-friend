/**
 * Cross-instance cache backed by Postgres (Supabase).
 * Combined with the per-isolate `memoize` (L1) this yields:
 *   L1 = single-flight + microcache within one Worker isolate
 *   L2 = shared TTL cache across all isolates / devices
 *
 * Result: with 10 tablets polling the dashboard every 90s, only ONE
 * Airtable upstream call is made per TTL window for the whole fleet.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { memoize } from "./cache.server";

const TABLE = "airtable_cache";

async function readShared<T>(key: string): Promise<T | undefined> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("payload, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (error || !data) return undefined;
    if (new Date(data.expires_at).getTime() <= Date.now()) return undefined;
    return data.payload as T;
  } catch {
    return undefined;
  }
}

async function writeShared<T>(key: string, value: T, ttlMs: number): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await supabaseAdmin
      .from(TABLE)
      .upsert(
        { cache_key: key, payload: value as any, expires_at: expiresAt, updated_at: new Date().toISOString() },
        { onConflict: "cache_key" },
      );
  } catch (err) {
    // Cache write failures are non-fatal: we still return data to caller.
    console.warn(`[shared-cache] write failed for ${key}:`, err);
  }
}

/**
 * Memoize across isolates: L1 (in-memory single-flight) wraps an L2 (Postgres) check.
 * Same call signature as `memoize` from cache.server.ts.
 */
export function sharedMemoize<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  return memoize(key, Math.min(ttlMs, 30_000), async () => {
    const shared = await readShared<T>(key);
    if (shared !== undefined) return shared;
    const value = await fetcher();
    // Fire-and-forget write so we don't block the response.
    void writeShared(key, value, ttlMs);
    return value;
  });
}

/**
 * Invalidate every cache_key starting with the given prefix in BOTH layers.
 */
export async function sharedInvalidate(prefix: string): Promise<void> {
  const { invalidate } = await import("./cache.server");
  invalidate(prefix);
  try {
    await supabaseAdmin.from(TABLE).delete().like("cache_key", `${prefix}%`);
  } catch (err) {
    console.warn(`[shared-cache] invalidate failed for prefix ${prefix}:`, err);
  }
}
