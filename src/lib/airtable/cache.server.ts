/**
 * In-memory cache with single-flight (request coalescing).
 * SERVER ONLY. Lives in the Worker isolate; per-instance, not global.
 *
 * Use to cap Airtable read pressure: when N tablets request the same data
 * within `ttlMs`, only one upstream fetch is performed; concurrent callers
 * during an in-flight fetch await the same Promise.
 *
 * Also implements a short *negative cache* on failure so that when Airtable
 * is degraded the entire fleet doesn't hammer it (one error result is shared
 * with all callers within `errorTtlMs`, default 5s).
 */

type Entry<T> = { value: T; expiresAt: number };
type ErrEntry = { error: unknown; expiresAt: number };

const stores = new Map<string, Entry<unknown>>();
const errors = new Map<string, ErrEntry>();
const inflight = new Map<string, Promise<unknown>>();

// Keep negative cache very short — one transient Airtable hiccup must not
// poison reads for every tablet for several seconds. Coalescing via `inflight`
// already prevents thundering-herd on the success path.
const DEFAULT_ERROR_TTL_MS = 750;

export function memoize<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  errorTtlMs: number = DEFAULT_ERROR_TTL_MS,
): Promise<T> {
  const now = Date.now();

  const cached = stores.get(key) as Entry<T> | undefined;
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);

  const cachedErr = errors.get(key);
  if (cachedErr && cachedErr.expiresAt > now) {
    return Promise.reject(cachedErr.error);
  }

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const p = (async () => {
    try {
      // Per-request fail-fast (30s) + up to 5 retries already live inside
      // airtableFetch. Give the wrapper enough headroom to complete the full
      // retry loop — a tighter timeout here cancels mid-retry and turns a
      // transient blip into a cached failure for every caller.
      const value = await Promise.race<T>([
        fetcher(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`cache fetch timeout for ${key}`)), 90_000),
        ),
      ]);
      stores.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } catch (err) {
      errors.set(key, { error: err, expiresAt: Date.now() + errorTtlMs });
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function invalidate(prefix: string) {
  for (const k of stores.keys()) if (k.startsWith(prefix)) stores.delete(k);
  for (const k of errors.keys()) if (k.startsWith(prefix)) errors.delete(k);
}
