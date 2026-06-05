/**
 * Supabase "override" sloj — trenutna vidljivost promena (start/pauza/...) pre
 * nego što Airtable automatizacija odgovori. Merge se radi na read strani
 * (dashboard) i automatski "reconcile"-uje kad Airtable sustigne.
 *
 * Server-only. RLS blokira sve direktne klijent pristupe; pristup samo preko
 * supabaseAdmin (service-role).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TABLE = "machine_overrides";

/** Patch sa poljima koja se prikazuju u Monitoring kartici. */
export type OverridePatch = Record<string, unknown>;
/** Mapa "kako proveriti da li je Airtable sustigao".
 *  Posebni ključevi: `skartGte` (broj), `notZastoj` (boolean).
 *  Ostali ključevi: ime polja iz reda mašine -> očekivana vrednost
 *  (`null` znači "polje je prazno/falsy"). */
export type OverrideExpected = Record<string, unknown>;

export interface OverrideRow {
  patch: OverridePatch;
  expected: OverrideExpected;
}

interface DbRow {
  monitoring_id: string;
  patch: OverridePatch | null;
  expected: OverrideExpected | null;
  expires_at: string;
}

let memoCache: { at: number; data: Map<string, OverrideRow> } | null = null;
const MEMO_TTL_MS = 1500;

/** Shallow merge dva objekta (sa undefined-ignore). */
function mergeShallow<T extends Record<string, unknown>>(a: T | null | undefined, b: T): T {
  const out: Record<string, unknown> = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b)) out[k] = v;
  return out as T;
}

export async function upsertOverride(
  monitoringId: string,
  patch: OverridePatch,
  expected: OverrideExpected,
  ttlMs: number = 120_000,
  replace: boolean = false,
): Promise<void> {
  try {
    let finalPatch: OverridePatch = patch;
    let finalExpected: OverrideExpected = expected;

    if (!replace) {
      const { data: existing } = await supabaseAdmin
        .from(TABLE)
        .select("patch, expected")
        .eq("monitoring_id", monitoringId)
        .maybeSingle();

      finalPatch = mergeShallow<OverridePatch>(
        (existing?.patch as OverridePatch | undefined) ?? {},
        patch,
      );
      finalExpected = mergeShallow<OverrideExpected>(
        (existing?.expected as OverrideExpected | undefined) ?? {},
        expected,
      );
    }

    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await supabaseAdmin.from(TABLE).upsert(
      {
        monitoring_id: monitoringId,
        patch: finalPatch as never,
        expected: finalExpected as never,
        updated_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: "monitoring_id" },
    );
    // Bust micro-cache
    memoCache = null;
  } catch (err) {
    console.warn(`[overrides] upsert failed for ${monitoringId}:`, err);
  }
}

export async function getActiveOverrides(): Promise<Map<string, OverrideRow>> {
  if (memoCache && Date.now() - memoCache.at < MEMO_TTL_MS) return memoCache.data;
  const map = new Map<string, OverrideRow>();
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("monitoring_id, patch, expected, expires_at")
      .gt("expires_at", new Date().toISOString());
    if (error || !data) {
      memoCache = { at: Date.now(), data: map };
      return map;
    }
    for (const r of data as DbRow[]) {
      map.set(r.monitoring_id, {
        patch: (r.patch ?? {}) as OverridePatch,
        expected: (r.expected ?? {}) as OverrideExpected,
      });
    }
  } catch (err) {
    console.warn("[overrides] read failed:", err);
  }
  memoCache = { at: Date.now(), data: map };
  return map;
}

/**
 * Ukloni iz `patch`/`expected` ključeve koje je Airtable sustigao.
 * Ako patch ostane prazan, obriši red. Fire-and-forget; greške se logguju.
 *
 * NAPOMENA: matchedExpectedKeys su ključevi iz `expected`. Mapiranje na patch
 * polja: standardni ključ = isti naziv u patch-u; `skartGte` -> patch.skart;
 * `notZastoj` -> patch.statusMasine.
 */
export async function reconcileAndDrop(
  monitoringId: string,
  matchedExpectedKeys: string[],
): Promise<void> {
  if (matchedExpectedKeys.length === 0) return;
  try {
    const { data: existing } = await supabaseAdmin
      .from(TABLE)
      .select("patch, expected")
      .eq("monitoring_id", monitoringId)
      .maybeSingle();
    if (!existing) return;

    const expected = { ...((existing.expected as OverrideExpected | null) ?? {}) };
    const patch = { ...((existing.patch as OverridePatch | null) ?? {}) };

    for (const k of matchedExpectedKeys) {
      delete expected[k];
      if (k === "skartGte") delete patch.skart;
      else if (k === "notZastoj") delete patch.statusMasine;
      else if (k === "poceoNeq") delete patch.vremeOtvaranjaNaloga;
      else delete patch[k];
    }



    if (Object.keys(patch).length === 0) {
      await supabaseAdmin.from(TABLE).delete().eq("monitoring_id", monitoringId);
    } else {
      await supabaseAdmin
        .from(TABLE)
        .update({ patch: patch as never, expected: expected as never, updated_at: new Date().toISOString() })
        .eq("monitoring_id", monitoringId);
    }
    memoCache = null;
  } catch (err) {
    console.warn(`[overrides] reconcile failed for ${monitoringId}:`, err);
  }
}

/** Obriši CEO override red (koristi se kad je override potpuno sustignut). */
export async function deleteOverride(monitoringId: string): Promise<void> {
  try {
    await supabaseAdmin.from(TABLE).delete().eq("monitoring_id", monitoringId);
    memoCache = null;
  } catch (err) {
    console.warn(`[overrides] delete failed for ${monitoringId}:`, err);
  }
}
