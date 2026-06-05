/**
 * App-level rate-limiting i lockout po `idZaposlenog`. Server-only.
 * Koristi Supabase tabelu `login_attempts` preko service-role klijenta.
 *
 * Pravila (prozor 15 min):
 *   5 neuspeha  -> 30s pauza
 *   8 neuspeha  -> 2 min lockout
 *   12 neuspeha -> 15 min lockout
 */

const WINDOW_MS = 15 * 60_000;

export type AttemptReason = "unknown_user" | "inactive" | "bad_pin" | "locked_out" | "ok" | "no_role";

export interface LockoutDecision {
  locked: boolean;
  retryAfterSec: number;
}

interface AttemptRow {
  success: boolean;
  attempted_at: string;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function recordAttempt(params: {
  idZaposlenog: string;
  uredaj?: string;
  ip?: string;
  success: boolean;
  reason: AttemptReason;
}): Promise<void> {
  try {
    const sb = await admin();
    await sb.from("login_attempts" as any).insert({
      id_zaposlenog: params.idZaposlenog,
      uredaj: params.uredaj ?? null,
      ip: params.ip ?? null,
      success: params.success,
      reason: params.reason,
    });
  } catch (e) {
    console.warn("login_attempts insert failed:", e);
  }
}

/**
 * Vraća lockout odluku na osnovu broja neuspeha posle poslednjeg
 * uspeha unutar prozora od 15 minuta.
 */
export async function checkLockout(idZaposlenog: string): Promise<LockoutDecision> {
  try {
    const sb = await admin();
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data, error } = await sb
      .from("login_attempts" as any)
      .select("success, attempted_at")
      .eq("id_zaposlenog", idZaposlenog)
      .gte("attempted_at", since)
      .order("attempted_at", { ascending: false })
      .limit(30);
    if (error || !data) return { locked: false, retryAfterSec: 0 };

    const rows = data as unknown as AttemptRow[];
    // Broj neuspeha od (uključujući) najnovijeg unazad, do prvog uspeha.
    let fails = 0;
    let lastFailAt = 0;
    for (const r of rows) {
      if (r.success) break;
      fails++;
      const t = Date.parse(r.attempted_at);
      if (t > lastFailAt) lastFailAt = t;
    }
    if (fails === 0) return { locked: false, retryAfterSec: 0 };

    let cooldownMs = 0;
    if (fails >= 12) cooldownMs = 15 * 60_000;
    else if (fails >= 8) cooldownMs = 2 * 60_000;
    else if (fails >= 5) cooldownMs = 30_000;

    if (cooldownMs === 0) return { locked: false, retryAfterSec: 0 };
    const elapsed = Date.now() - lastFailAt;
    const remain = cooldownMs - elapsed;
    if (remain <= 0) return { locked: false, retryAfterSec: 0 };
    return { locked: true, retryAfterSec: Math.ceil(remain / 1000) };
  } catch (e) {
    console.warn("checkLockout failed:", e);
    return { locked: false, retryAfterSec: 0 };
  }
}

export function clientIp(headers: Headers): string | undefined {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xf = headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return undefined;
}
