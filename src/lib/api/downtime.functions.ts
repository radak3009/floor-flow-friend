import { createServerFn } from "@tanstack/react-start";
import { Monitoring, Zastoji, PromeneNaloga } from "@/lib/airtable/sdk.server";
import type { RecordOf } from "@/lib/airtable/types";
import { findIdByClientOpId } from "@/lib/airtable/dedupe.server";
import { upsertOverride } from "@/lib/api/overrides.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Prozor unutar koga se zastoji za istu liniju smatraju duplikatom (klijent je istekao i pokušao ponovo).
const DOWNTIME_DEDUP_WINDOW_MS = 30_000;

type ZastojRow = RecordOf<"Zastoji">;

async function findActiveZastoj(monitoringId: string): Promise<ZastojRow | null> {
  const mon = await Monitoring.findOne({ id: monitoringId });
  if (!mon || !mon.zastoji) return null;
  const ids: string[] = Array.isArray(mon.zastoji)
    ? (mon.zastoji.filter((x): x is string => typeof x === "string"))
    : typeof mon.zastoji === "string" ? [mon.zastoji] : [];
  const lastId = ids[ids.length - 1];
  if (!lastId) return null;
  const z = await Zastoji.findOne({ id: lastId });
  if (!z) return null;
  const isActive = z.statusZastoja === "Aktivan" || (!z.kraj && !z.definisanKraj);
  return isActive ? z : null;
}

export const getActiveDowntimeFn = createServerFn({ method: "GET" })
  .inputValidator((input: { monitoringId: string }) => {
    if (!input.monitoringId) throw new Error("monitoringId je obavezan");
    return input;
  })
  .handler(async ({ data }): Promise<{ found: boolean; zastojId?: string; start?: string }> => {
    const z = await findActiveZastoj(data.monitoringId);
    if (!z) return { found: false };
    return { found: true, zastojId: z.id, start: typeof z.start === "string" ? z.start : undefined };
  });

interface LogDowntimeInput {
  monitoringId: string;
  userId: string;
  grupaId?: string;
  grupaNaziv?: string;
  tipId?: string;
  komentar?: string;
  ongoing: boolean;
  kraj?: string;
  clientOpId?: string;
  idempotencyKey?: string;
}

type LogDowntimeResult = {
  ok: true;
  activeZastojStart?: string;
  deduped?: true;
};

export const logDowntimeFn = createServerFn({ method: "POST" })
  .inputValidator((input: LogDowntimeInput) => {
    if (!input.monitoringId) throw new Error("monitoringId je obavezan");
    if (!input.userId) throw new Error("userId je obavezan");
    if (typeof input.ongoing !== "boolean") throw new Error("ongoing je obavezan");
    if (!input.ongoing && !input.kraj) throw new Error("Kraj je obavezan kada zastoj nije u toku");
    return input;
  })
  .handler(async ({ data }): Promise<LogDowntimeResult> => {
    // 1) Idempotency key — sinhroni backstop u našem Postgres-u (UNIQUE PRIMARY KEY).
    //    Ako isti ključ već postoji → vrati postojeći rezultat (no-op).
    if (data.idempotencyKey) {
      const { data: existing } = await supabaseAdmin
        .from("downtime_idempotency")
        .select("result")
        .eq("idempotency_key", data.idempotencyKey)
        .maybeSingle();
      if (existing) {
        const stored = (existing.result ?? {}) as Partial<LogDowntimeResult>;
        return { ok: true, activeZastojStart: stored.activeZastojStart, deduped: true };
      }
    }

    // 2) Legacy clientOpId dedup preko Airtable (kasni; ostavljeno kao dodatni backstop).
    if (data.clientOpId) {
      const existing = await findIdByClientOpId("PromeneNaloga", data.clientOpId);
      if (existing) return { ok: true, activeZastojStart: undefined, deduped: true };
    }

    // 3) Overlap dedup — ako je u poslednjih N sekundi već primljen upis za istu liniju,
    //    tretiraj kao duplikat (klijent je verovatno poslao više puta zbog tap-a/refresh-a).
    const sinceIso = new Date(Date.now() - DOWNTIME_DEDUP_WINDOW_MS).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("downtime_idempotency")
      .select("result, ongoing")
      .eq("monitoring_id", data.monitoringId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1);
    if (recent && recent.length > 0 && recent[0].ongoing === data.ongoing) {
      const stored = (recent[0].result ?? {}) as Partial<LogDowntimeResult>;
      return { ok: true, activeZastojStart: stored.activeZastojStart, deduped: true };
    }

    const z = await findActiveZastoj(data.monitoringId);
    if (!z) throw new Error("Nema aktivnog zastoja za ovu liniju");

    const record: Record<string, unknown> = {
      zastoj: [z.id],
      opcija: data.ongoing ? "Definisanje" : "Podela",
      start: z.start,
      kreiraola: [data.userId],
    };
    if (z.radniNalog) {
      const rn = z.radniNalog;
      record.radniNalog = Array.isArray(rn) ? rn : [rn];
    }
    if (data.grupaId) record.grupa = [data.grupaId];
    if (data.tipId) record.tip = [data.tipId];
    if (data.komentar) record.komentar = data.komentar;
    if (!data.ongoing && data.kraj) record.kraj = data.kraj;
    if (data.clientOpId) record.__extraFields = { clientOpId: data.clientOpId };

    await PromeneNaloga.create({ record });

    // Override sloj — trenutna vidljivost dok Airtable automatizacija ne sustigne
    if (data.ongoing) {
      // Definisanje: prikaži grupu odmah i forsiraj statusMasine="Zastoj"
      // kako bi se pregazio eventualni rezidualni override iz start/resume
      // (koji postavlja statusMasine="U radu" sa TTL 120s).
      const patch: Record<string, unknown> = { statusMasine: "Zastoj" };
      const expected: Record<string, unknown> = { statusMasine: "Zastoj" };
      if (data.grupaNaziv) {
        patch.grupaZastoja = data.grupaNaziv;
        expected.grupaZastoja = data.grupaNaziv;
      }
      await upsertOverride(data.monitoringId, patch, expected);
    } else if (!data.ongoing) {
      // Podela: zastoj je završen — mašina više nije u "Zastoj"
      await upsertOverride(
        data.monitoringId,
        { statusMasine: "U radu", grupaZastoja: null },
        { notZastoj: true },
      );
    }

    return { ok: true as const, activeZastojStart: typeof z.start === "string" ? z.start : undefined };
  });

