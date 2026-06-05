import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AcquireResult =
  | { ok: true; previousStatus: string }
  | { ok: false; conflict: true; currentStatus: string };

/**
 * Atomski "compare-and-swap" tranzicije statusa radnog naloga preko Postgresa.
 * Ako lock red ne postoji, kreira ga sa `airtableStatus` kao trenutnim, pa pokušava CAS.
 */
export async function acquireTransition(params: {
  radniNalogId: string;
  fromStatuses: string[];
  toStatus: string;
  userId: string;
  airtableStatus: string;
}): Promise<AcquireResult> {
  const { radniNalogId, fromStatuses, toStatus, userId, airtableStatus } = params;

  // 1) Upsert početnog reda (no-op ako postoji). ON CONFLICT DO NOTHING preko upsert + ignoreDuplicates.
  await supabaseAdmin
    .from("wo_status_locks")
    .upsert(
      { radni_nalog_id: radniNalogId, current_status: airtableStatus, updated_by: userId },
      { onConflict: "radni_nalog_id", ignoreDuplicates: true },
    );

  // 2) Conditional UPDATE: prolazi samo ako je trenutni status u dozvoljenoj listi.
  const tryCas = async () => {
    return await supabaseAdmin
      .from("wo_status_locks")
      .update({ current_status: toStatus, updated_at: new Date().toISOString(), updated_by: userId })
      .eq("radni_nalog_id", radniNalogId)
      .in("current_status", fromStatuses)
      .select("current_status");
  };

  let { data, error } = await tryCas();
  if (error) {
    throw new Error(`Lock greška: ${error.message}`);
  }

  if (!data || data.length === 0) {
    // Pročitaj trenutni status locka.
    const { data: cur } = await supabaseAdmin
      .from("wo_status_locks")
      .select("current_status")
      .eq("radni_nalog_id", radniNalogId)
      .maybeSingle();
    const lockStatus = cur?.current_status ?? airtableStatus;

    // Drift recovery: Airtable (izvor istine) kaže da je tranzicija validna,
    // ali je lokalni lock zaglavljen na nečem drugom (npr. status promenjen
    // van aplikacije, ili kompenzacija nije izvršena). Sinhronizuj lock sa
    // Airtable-om i pokušaj CAS ponovo — samo jednom.
    if (lockStatus !== airtableStatus && fromStatuses.includes(airtableStatus)) {
      const { error: syncErr } = await supabaseAdmin
        .from("wo_status_locks")
        .update({ current_status: airtableStatus, updated_at: new Date().toISOString(), updated_by: userId })
        .eq("radni_nalog_id", radniNalogId)
        .eq("current_status", lockStatus);
      if (syncErr) {
        throw new Error(`Lock drift sync greška: ${syncErr.message}`);
      }
      const retry = await tryCas();
      if (retry.error) {
        throw new Error(`Lock greška: ${retry.error.message}`);
      }
      if (retry.data && retry.data.length > 0) {
        return { ok: true, previousStatus: airtableStatus };
      }
      // Re-read za poruku konflikta.
      const { data: cur2 } = await supabaseAdmin
        .from("wo_status_locks")
        .select("current_status")
        .eq("radni_nalog_id", radniNalogId)
        .maybeSingle();
      return { ok: false, conflict: true, currentStatus: cur2?.current_status ?? lockStatus };
    }

    return { ok: false, conflict: true, currentStatus: lockStatus };
  }

  return { ok: true, previousStatus: airtableStatus };
}

/**
 * Kompenzaciono vraćanje locka kad Airtable korak padne posle uspešnog CAS-a.
 * Vraća lock na `revertTo` SAMO ako je trenutno još uvek `expected`.
 */
export async function releaseTransition(params: {
  radniNalogId: string;
  expected: string;
  revertTo: string;
}): Promise<void> {
  const { radniNalogId, expected, revertTo } = params;
  await supabaseAdmin
    .from("wo_status_locks")
    .update({ current_status: revertTo, updated_at: new Date().toISOString() })
    .eq("radni_nalog_id", radniNalogId)
    .eq("current_status", expected);
}

export function conflictError(currentStatus: string): Error {
  return new Error(`KONFLIKT: nalog je već u statusu "${currentStatus}". Osvežite listu.`);
}
