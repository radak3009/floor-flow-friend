/**
 * Bootstrap server funkcije za prvu konfiguraciju Airtable baze
 * NAKON remix-a — pre nego što iko može da se uloguje.
 *
 * Bezbednosni model:
 * - "Bootstrap mode" je aktivan dok god `airtable_config` ne sadrži validnu mapu.
 * - Dok je bootstrap mode aktivan, ove funkcije RADE BEZ LOGINA.
 * - Kada postoji validna mapa (sistem je već konfigurisan), funkcije zahtevaju
 *   header `X-Setup-Token` koji odgovara secretu `SETUP_TOKEN` (re-bootstrap).
 *
 * Sva polja koja idu u bazu validiraju se Zod-om. Nikakvi PII ni payload-i se ne
 * vraćaju ka klijentu osim onoga što je potrebno za UI wizarda.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestHeader } from "@tanstack/react-start/server";
import {
  loadActiveConfig,
  saveActiveConfig,
  saveSchemaMaps,
  invalidateConfigCache,
  finalizeConfig,
} from "@/lib/airtable/config.server";
import {
  regenerateSchemaCore,
  type RegenDiff,
} from "@/lib/airtable/config.functions";
import {
  computeMissingRequired,
  type MissingRequiredEntry,
} from "@/lib/airtable/required-schema";

const BOOTSTRAP_USER = "bootstrap";

async function isBootstrapMode(): Promise<boolean> {
  const cfg = await loadActiveConfig();
  if (!cfg) return true;
  if (!cfg.tables || !cfg.fields) return true;
  if (Object.keys(cfg.tables).length === 0) return true;
  if (!cfg.finalized) return true;
  return false;
}

async function assertBootstrapAllowed(): Promise<void> {
  if (await isBootstrapMode()) return;
  const expected = process.env.SETUP_TOKEN;
  const provided = getRequestHeader("x-setup-token");
  if (expected && provided && provided === expected) return;
  throw new Error(
    "Sistem je već konfigurisan. Bootstrap nije dozvoljen bez važećeg SETUP_TOKEN-a.",
  );
}

// ---------- Rate limit (in-memory, by IP-less bucket) ----------
const RATE: Map<string, number> = new Map();
const RATE_WINDOW_MS = 5_000;
function rl(key: string): void {
  const now = Date.now();
  const prev = RATE.get(key) ?? 0;
  if (now - prev < RATE_WINDOW_MS) throw new Error("Previše zahteva, sačekaj nekoliko sekundi.");
  RATE.set(key, now);
}

// ---------- Schemas ----------
const SaveCredsSchema = z.object({
  pat: z
    .string()
    .trim()
    .min(20)
    .max(200)
    .regex(/^pat[A-Za-z0-9]+\.[A-Za-z0-9]+$/, "PAT mora počinjati sa 'pat' i imati format pat<id>.<secret>"),
  baseId: z
    .string()
    .trim()
    .regex(/^app[A-Za-z0-9]{14,}$/, "Base ID mora počinjati sa 'app' i imati 14+ karaktera"),
});

const ManualOverridesSchema = z.object({
  overrides: z
    .array(
      z.object({
        table: z.string().min(1).max(100),
        key: z.string().min(1).max(100),
        fieldId: z.string().regex(/^fld[A-Za-z0-9]+$/),
      }),
    )
    .max(500),
});

// ---------- State (open) ----------
export interface BootstrapState {
  bootstrapMode: boolean;
  hasOverride: boolean;
  hasTablesMap: boolean;
  baseId: string | null;
  updatedAt: string | null;
}

export const getBootstrapStateFn = createServerFn({ method: "POST" })
  .handler(async (): Promise<BootstrapState> => {
    const cfg = await loadActiveConfig();
    const bootstrapMode = await isBootstrapMode();
    return {
      bootstrapMode,
      hasOverride: !!cfg,
      hasTablesMap: !!(cfg?.tables && Object.keys(cfg.tables).length > 0),
      baseId: cfg?.baseId ?? null,
      updatedAt: cfg?.updatedAt ?? null,
    };
  });

// ---------- 1. Sačuvaj PAT + Base ID (test poziv) ----------
export const bootstrapSaveCredsFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SaveCredsSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; tableCount: number }> => {
    await assertBootstrapAllowed();
    rl("save-creds");
    const testUrl = `https://api.airtable.com/v0/meta/bases/${data.baseId}/tables`;
    const res = await fetch(testUrl, { headers: { Authorization: `Bearer ${data.pat}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Airtable test poziv ne radi (${res.status}). Proveri PAT (scope: schema.bases:read, data.records:read/write) i Base ID. ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as { tables?: Array<{ id: string; name: string }> };
    const tableCount = json.tables?.length ?? 0;
    await saveActiveConfig({ baseId: data.baseId, pat: data.pat, updatedBy: BOOTSTRAP_USER });
    return { ok: true, tableCount };
  });

// ---------- 2. Regeneriši mapu + vrati missingRequired ----------
export const bootstrapRegenerateFn = createServerFn({ method: "POST" })
  .handler(async (): Promise<RegenDiff & { rawTablesByCamelKey: Record<string, Array<{ id: string; name: string }>> }> => {
    await assertBootstrapAllowed();
    rl("regen");
    invalidateConfigCache();
    const cfg = await loadActiveConfig();
    if (!cfg) throw new Error("Prvo sačuvaj PAT i Base ID.");

    const core = await regenerateSchemaCore({ baseId: cfg.baseId, pat: cfg.pat });
    await saveSchemaMaps({
      tables: core.tablesMap,
      fields: core.fieldsMap,
      updatedBy: BOOTSTRAP_USER,
    });
    const missingRequired = computeMissingRequired({
      fields: core.fieldsMap,
      rawTablesByCamelKey: core.rawTablesByCamelKey,
    });
    return { ...core.diff, missingRequired, rawTablesByCamelKey: core.rawTablesByCamelKey };
  });

// ---------- 3. Primeni ručne override-e + revaliduj ----------
export const bootstrapApplyOverridesFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ManualOverridesSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; missingRequired: MissingRequiredEntry[]; rawTablesByCamelKey: Record<string, Array<{ id: string; name: string }>> }> => {
    await assertBootstrapAllowed();
    rl("overrides");
    invalidateConfigCache();
    const cfg = await loadActiveConfig();
    if (!cfg || !cfg.tables || !cfg.fields) {
      throw new Error("Prvo regeneriši mapu.");
    }
    const fields = JSON.parse(JSON.stringify(cfg.fields)) as Record<string, Record<string, string>>;
    for (const o of data.overrides) {
      if (!fields[o.table]) fields[o.table] = {};
      fields[o.table][o.key] = o.fieldId;
    }
    await saveSchemaMaps({ tables: cfg.tables, fields, updatedBy: BOOTSTRAP_USER });

    const core = await regenerateSchemaCore({ baseId: cfg.baseId, pat: cfg.pat });
    const missingRequired = computeMissingRequired({
      fields,
      rawTablesByCamelKey: core.rawTablesByCamelKey,
    });
    return { ok: true, missingRequired, rawTablesByCamelKey: core.rawTablesByCamelKey };
  });

// ---------- 4. Supabase readiness ----------
export interface SupabaseTableStatus {
  table: string;
  ok: boolean;
  error?: string;
}

const REQUIRED_SUPABASE_TABLES = [
  "machine_overrides",
  "wo_status_locks",
  "airtable_cache",
  "login_attempts",
  "comments",
  "notifications",
  "pwa_config",
  "airtable_config",
] as const;

export const getSupabaseReadinessFn = createServerFn({ method: "POST" })
  .handler(async (): Promise<{ tables: SupabaseTableStatus[]; allOk: boolean }> => {
    await assertBootstrapAllowed();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results: SupabaseTableStatus[] = [];
    for (const t of REQUIRED_SUPABASE_TABLES) {
      try {
        const { error } = await supabaseAdmin
          .from(t)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .select("*", { head: true, count: "exact" } as any)
          .limit(0);
        if (error) {
          results.push({ table: t, ok: false, error: error.message });
        } else {
          results.push({ table: t, ok: true });
        }
      } catch (e) {
        results.push({ table: t, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { tables: results, allOk: results.every((r) => r.ok) };
  });

// ---------- 5. Smoke test (PAT write scope + kritični upisi) ----------
export interface SmokeCheck {
  ok: boolean;
  message?: string;
}
export interface SmokeTestResult {
  patWrite: SmokeCheck;
  promeneNaloga: SmokeCheck;
  prijaveNaSistem: SmokeCheck;
}

async function airtableCreateThenDelete(params: {
  baseId: string;
  pat: string;
  tableId: string;
  fields: Record<string, unknown>;
}): Promise<SmokeCheck> {
  try {
    const createRes = await fetch(
      `https://api.airtable.com/v0/${params.baseId}/${params.tableId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.pat}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: [{ fields: params.fields }], typecast: true }),
      },
    );
    if (!createRes.ok) {
      const txt = await createRes.text();
      return { ok: false, message: `${createRes.status}: ${txt.slice(0, 300)}` };
    }
    const json = (await createRes.json()) as { records?: Array<{ id: string }> };
    const recId = json.records?.[0]?.id;
    if (recId) {
      await fetch(
        `https://api.airtable.com/v0/${params.baseId}/${params.tableId}/${recId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${params.pat}` } },
      ).catch(() => {});
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function resolveByName<T>(
  map: Record<string, T> | undefined | null,
  name: string,
): T | undefined {
  if (!map) return undefined;
  if (map[name] !== undefined) return map[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(map)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

export const bootstrapSmokeTestFn = createServerFn({ method: "POST" })
  .handler(async (): Promise<SmokeTestResult> => {
    await assertBootstrapAllowed();
    rl("smoke");
    const cfg = await loadActiveConfig();
    if (!cfg || !cfg.tables) throw new Error("Prvo regeneriši mapu.");

    const promeneTableId = resolveByName(cfg.tables, "PromeneNaloga");
    const prijaveTableId = resolveByName(cfg.tables, "PrijaveNaSistem");
    const promeneFields = resolveByName(cfg.fields ?? {}, "PromeneNaloga");
    const prijaveFields = resolveByName(cfg.fields ?? {}, "PrijaveNaSistem");

    // 1) PAT write scope + Promene upis (koristi fieldId iz mape, ne naziv)
    let promeneResult: SmokeCheck = { ok: false, message: "Tabela PromeneNaloga nije mapirana" };
    if (promeneTableId) {
      const komentarFieldId = resolveByName(promeneFields, "komentar");
      if (!komentarFieldId) {
        promeneResult = { ok: false, message: "Polje 'komentar' u PromeneNaloga nije mapirano" };
      } else {
        promeneResult = await airtableCreateThenDelete({
          baseId: cfg.baseId,
          pat: cfg.pat,
          tableId: promeneTableId,
          fields: { [komentarFieldId]: "__smoke_test__ (auto-delete)" },
        });
      }
    }

    const patWrite: SmokeCheck = promeneResult.ok
      ? { ok: true }
      : /403|PERMISSION|INVALID_PERMISSIONS|NOT_AUTHORIZED/i.test(promeneResult.message ?? "")
        ? { ok: false, message: "PAT nema data.records:write scope. Dodaj scope na airtable.com/create/tokens." }
        : { ok: true, message: "Nije moguće potvrditi (upis je pao iz drugog razloga)" };

    // 2) PrijaveNaSistem upis
    let prijaveResult: SmokeCheck = { ok: false, message: "Tabela PrijaveNaSistem nije mapirana" };
    if (prijaveTableId) {
      const datumFieldId = resolveByName(prijaveFields, "datumIVremePrijave");
      if (!datumFieldId) {
        prijaveResult = { ok: false, message: "Polje 'datumIVremePrijave' u PrijaveNaSistem nije mapirano" };
      } else {
        prijaveResult = await airtableCreateThenDelete({
          baseId: cfg.baseId,
          pat: cfg.pat,
          tableId: prijaveTableId,
          fields: { [datumFieldId]: new Date().toISOString() },
        });
      }
    }

    return {
      patWrite,
      promeneNaloga: promeneResult,
      prijaveNaSistem: prijaveResult,
    };
  });

// ---------- 6. Finalize bootstrap (lock the wizard) ----------
export const bootstrapFinalizeFn = createServerFn({ method: "POST" })
  .handler(async (): Promise<{ ok: true }> => {
    await assertBootstrapAllowed();
    const cfg = await loadActiveConfig();
    if (!cfg || !cfg.tables || !cfg.fields || Object.keys(cfg.tables).length === 0) {
      throw new Error("Konfiguracija nije kompletna — nije moguće finalizovati.");
    }
    await finalizeConfig(BOOTSTRAP_USER);
    return { ok: true };
  });
