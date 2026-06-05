import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { KontaktOsobe, Role } from "@/lib/airtable/sdk.server";
import {
  getConfigStatus,
  loadActiveConfig,
  saveActiveConfig,
  saveSchemaMaps,
  clearActiveConfig,
  invalidateConfigCache,
  type ConfigStatus,
} from "@/lib/airtable/config.server";
import { TABLES as STATIC_TABLES, FIELDS as STATIC_FIELDS } from "@/lib/airtable/schema";
import {
  REQUIRED_SCHEMA,
  OPTIONAL_FIELDS,
  computeMissingRequired,
  type MissingRequiredEntry,
} from "@/lib/airtable/required-schema";

const firstId = (v: unknown): string | undefined => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" && x.startsWith("rec") ? x : undefined;
};

async function assertSuperAdmin(currentUserId: string): Promise<void> {
  if (!currentUserId) throw new Error("Unauthorized");
  const u = await KontaktOsobe.findOne({ id: currentUserId });
  if (!u) throw new Error("Unauthorized");
  const roleId = firstId((u as any).uloga);
  if (!roleId) throw new Error("Nemate dozvolu (Super Admin only).");
  const r = await Role.findOne({ id: roleId });
  const name = (r as any)?.naziv ? String((r as any).naziv).trim().toLowerCase() : "";
  if (name !== "super admin") throw new Error("Nemate dozvolu (Super Admin only).");
}

// ---------- Rate limit (in-memory, per-user) ----------
const RATE: Map<string, number> = new Map();
const RATE_WINDOW_MS = 10_000;
function rateLimit(userId: string, action: string): void {
  const k = `${action}:${userId}`;
  const now = Date.now();
  const prev = RATE.get(k) ?? 0;
  if (now - prev < RATE_WINDOW_MS) {
    throw new Error("Previše zahteva, sačekaj nekoliko sekundi.");
  }
  RATE.set(k, now);
}

// ---------- Helpers ----------
export function toCamel(name: string): string {
  // strip diacritics, replace non-alnum with space, then camelCase first lower
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (m) => (m === "Đ" ? "Dj" : "dj"));
  const parts = normalized
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  if (parts.length === 0) return "field";
  return parts
    .map((p, i) =>
      i === 0
        ? p.toLowerCase()
        : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
    )
    .join("")
    .replace(/^[^a-zA-Z_]/, "_$&");

}

function dedupe(camel: string, used: Set<string>): string {
  if (!used.has(camel)) {
    used.add(camel);
    return camel;
  }
  let n = 2;
  while (used.has(`${camel}${n}`)) n++;
  const out = `${camel}${n}`;
  used.add(out);
  return out;
}

// ---------- Inputs ----------
const StatusSchema = z.object({ currentUserId: z.string().min(1) });
const SaveCredsSchema = z.object({
  currentUserId: z.string().min(1),
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
const RegenSchema = z.object({ currentUserId: z.string().min(1) });
const ClearSchema = z.object({ currentUserId: z.string().min(1) });

const ManualOverridesSchema = z.object({
  currentUserId: z.string().min(1),
  overrides: z.array(
    z.object({
      table: z.string().min(1).max(100),
      key: z.string().min(1).max(100),
      fieldId: z.string().regex(/^fld[A-Za-z0-9]+$/),
    }),
  ).min(1).max(500),
});

// ---------- Core regeneration helper (used by both auth + bootstrap) ----------
export interface RegenCoreResult {
  tablesMap: Record<string, string>;
  fieldsMap: Record<string, Record<string, string>>;
  /** Po camelCase ključu tabele — sirov spisak polja (id+name) iz nove baze */
  rawTablesByCamelKey: Record<string, Array<{ id: string; name: string }>>;
  diff: Omit<RegenDiff, "missingRequired">;
}

export async function regenerateSchemaCore(cfg: { baseId: string; pat: string }): Promise<RegenCoreResult> {
  const url = `https://api.airtable.com/v0/meta/bases/${cfg.baseId}/tables`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.pat}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable Metadata API greška (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string }> }>;
  };

  const tablesMap: Record<string, string> = {};
  const fieldsMap: Record<string, Record<string, string>> = {};
  const rawTablesByCamelKey: Record<string, Array<{ id: string; name: string }>> = {};
  const usedTableKeys = new Set<string>();

  const staticTableNames = new Set(Object.keys(STATIC_TABLES));

  for (const t of json.tables) {
    let camel = staticTableNames.has(t.name) ? t.name : toCamel(t.name);
    camel = dedupe(camel, usedTableKeys);
    tablesMap[camel] = t.id;
    rawTablesByCamelKey[camel] = t.fields.map((f) => ({ id: f.id, name: f.name }));

    const usedFieldKeys = new Set<string>();
    const fMap: Record<string, string> = {};
    const staticFieldsForTable: Record<string, string> | undefined = (STATIC_FIELDS as any)[camel];

    for (const f of t.fields) {
      let fCamel: string;
      if (staticFieldsForTable && Object.prototype.hasOwnProperty.call(staticFieldsForTable, f.name)) {
        fCamel = f.name;
      } else {
        fCamel = toCamel(f.name);
      }
      fCamel = dedupe(fCamel, usedFieldKeys);
      fMap[fCamel] = f.id;
    }
    fieldsMap[camel] = fMap;
  }

  // Diff vs static schema (for informational purposes only)
  const newTableNames = new Set(Object.keys(tablesMap));
  const addedTables = [...newTableNames].filter((n) => !staticTableNames.has(n));
  const removedTables = [...staticTableNames].filter((n) => !newTableNames.has(n));

  const addedFieldsByTable: Record<string, string[]> = {};
  const removedFieldsByTable: Record<string, string[]> = {};
  for (const t of newTableNames) {
    const staticFs = (STATIC_FIELDS as any)[t] as Record<string, string> | undefined;
    if (!staticFs) continue;
    const newFs = new Set(Object.keys(fieldsMap[t]));
    const oldFs = new Set(Object.keys(staticFs));
    const added = [...newFs].filter((n) => !oldFs.has(n));
    const removed = [...oldFs].filter((n) => !newFs.has(n));
    if (added.length) addedFieldsByTable[t] = added;
    if (removed.length) removedFieldsByTable[t] = removed;
  }

  let fieldCount = 0;
  for (const m of Object.values(fieldsMap)) fieldCount += Object.keys(m).length;

  return {
    tablesMap,
    fieldsMap,
    rawTablesByCamelKey,
    diff: {
      tableCount: Object.keys(tablesMap).length,
      fieldCount,
      addedTables,
      removedTables,
      addedFieldsByTable,
      removedFieldsByTable,
    },
  };
}

// ---------- Public types ----------
export interface RegenDiff {
  tableCount: number;
  fieldCount: number;
  addedTables: string[];
  removedTables: string[];
  addedFieldsByTable: Record<string, string[]>;
  removedFieldsByTable: Record<string, string[]>;
  /** Obavezni ključevi iz REQUIRED_SCHEMA koji nisu pronađeni — treba ih ručno mapirati */
  missingRequired: MissingRequiredEntry[];
}

// ---------- Server functions (Super Admin only) ----------
export const getAirtableConfigStatusFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => StatusSchema.parse(d))
  .handler(async ({ data }): Promise<ConfigStatus> => {
    await assertSuperAdmin(data.currentUserId);
    return getConfigStatus();
  });

export const saveAirtableCredentialsFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SaveCredsSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; tableCount: number }> => {
    await assertSuperAdmin(data.currentUserId);
    rateLimit(data.currentUserId, "save-creds");

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

    await saveActiveConfig({ baseId: data.baseId, pat: data.pat, updatedBy: data.currentUserId });
    return { ok: true, tableCount };
  });

export const regenerateSchemaMapsFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RegenSchema.parse(d))
  .handler(async ({ data }): Promise<RegenDiff> => {
    await assertSuperAdmin(data.currentUserId);
    rateLimit(data.currentUserId, "regen");
    invalidateConfigCache();
    const cfg = await loadActiveConfig();
    if (!cfg) throw new Error("Prvo sačuvaj PAT i Base ID, pa onda regeneriši mapu.");

    const core = await regenerateSchemaCore({ baseId: cfg.baseId, pat: cfg.pat });
    await saveSchemaMaps({
      tables: core.tablesMap,
      fields: core.fieldsMap,
      updatedBy: data.currentUserId,
    });

    const missingRequired = computeMissingRequired({
      fields: core.fieldsMap,
      rawTablesByCamelKey: core.rawTablesByCamelKey,
    });

    return { ...core.diff, missingRequired };
  });

/** Snima ručne override-e za pojedinačna polja (npr. kada match po imenu ne uspe). */
export const saveManualFieldOverridesFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ManualOverridesSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; appliedCount: number; missingRequired: MissingRequiredEntry[] }> => {
    await assertSuperAdmin(data.currentUserId);
    invalidateConfigCache();
    const cfg = await loadActiveConfig();
    if (!cfg || !cfg.tables || !cfg.fields) {
      throw new Error("Prvo regeneriši mapu, pa onda primeni manuelne override-e.");
    }
    const fields = JSON.parse(JSON.stringify(cfg.fields)) as Record<string, Record<string, string>>;
    let applied = 0;
    for (const o of data.overrides) {
      if (!fields[o.table]) fields[o.table] = {};
      fields[o.table][o.key] = o.fieldId;
      applied++;
    }
    await saveSchemaMaps({
      tables: cfg.tables,
      fields,
      updatedBy: data.currentUserId,
    });
    // Re-pull live metadata to recompute missingRequired (so user sees real-time state)
    const core = await regenerateSchemaCore({ baseId: cfg.baseId, pat: cfg.pat });
    const missingRequired = computeMissingRequired({
      fields,
      rawTablesByCamelKey: core.rawTablesByCamelKey,
    });
    return { ok: true, appliedCount: applied, missingRequired };
  });

export const clearAirtableOverrideFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ClearSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await assertSuperAdmin(data.currentUserId);
    await clearActiveConfig();
    return { ok: true };
  });

/** Pomoćni server fn — vraća listu nedostajućih obaveznih polja na osnovu žive mape. */
export const getMissingRequiredFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => StatusSchema.parse(d))
  .handler(async ({ data }): Promise<{ missingRequired: MissingRequiredEntry[]; hasOverride: boolean }> => {
    await assertSuperAdmin(data.currentUserId);
    const cfg = await loadActiveConfig();
    if (!cfg || !cfg.tables || !cfg.fields) {
      return { missingRequired: [], hasOverride: false };
    }
    const core = await regenerateSchemaCore({ baseId: cfg.baseId, pat: cfg.pat });
    const missingRequired = computeMissingRequired({
      fields: cfg.fields,
      rawTablesByCamelKey: core.rawTablesByCamelKey,
    });
    return { missingRequired, hasOverride: true };
  });

// Re-export required-schema labels for UI
export { REQUIRED_SCHEMA } from "@/lib/airtable/required-schema";
export type { MissingRequiredEntry } from "@/lib/airtable/required-schema";

// ---------- Field mapping overview (Pre/Posle prikaz za Super Admin) ----------
export interface FieldMappingEntry {
  table: string;
  tableLabel: string;
  key: string;
  expectedLabel: string;
  hint?: string;
  isOptional: boolean;
  /** Trenutni mapirani fieldId (iz cfg.fields), ako postoji */
  currentFieldId?: string;
  /** Aktuelno ime tog polja u Airtable bazi (live metadata) */
  currentFieldName?: string;
  /** 'mapped' = ima fieldId i postoji u bazi; 'missing' = nije mapirano; 'stale' = mapirano ali fieldId više ne postoji u bazi */
  status: "mapped" | "missing" | "stale";
  /** Kandidati za ručno mapiranje (sva polja te tabele u bazi) */
  candidates: Array<{ id: string; name: string }>;
}

export interface FieldMappingOverview {
  hasOverride: boolean;
  baseId: string | null;
  required: FieldMappingEntry[];
  optional: FieldMappingEntry[];
}

export const getFieldMappingOverviewFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => StatusSchema.parse(d))
  .handler(async ({ data }): Promise<FieldMappingOverview> => {
    await assertSuperAdmin(data.currentUserId);
    const cfg = await loadActiveConfig();
    if (!cfg || !cfg.tables || !cfg.fields) {
      return { hasOverride: false, baseId: cfg?.baseId ?? null, required: [], optional: [] };
    }
    const core = await regenerateSchemaCore({ baseId: cfg.baseId, pat: cfg.pat });

    const buildEntry = (
      table: string,
      tableLabel: string,
      key: string,
      label: string,
      hint: string | undefined,
      isOptional: boolean,
    ): FieldMappingEntry => {
      // case-insensitive lookup po camelKey tabele
      const tableFieldsByLower: Record<string, { realKey: string; map: Record<string, string> }> = {};
      for (const [k, v] of Object.entries(cfg.fields ?? {})) {
        tableFieldsByLower[k.toLowerCase()] = { realKey: k, map: v };
      }
      const rawByLower: Record<string, Array<{ id: string; name: string }>> = {};
      for (const [k, v] of Object.entries(core.rawTablesByCamelKey)) {
        rawByLower[k.toLowerCase()] = v;
      }

      const tEntry =
        cfg.fields?.[table] !== undefined
          ? { map: cfg.fields[table] }
          : tableFieldsByLower[table.toLowerCase()];
      const candidates =
        core.rawTablesByCamelKey[table] ?? rawByLower[table.toLowerCase()] ?? [];

      let currentFieldId: string | undefined;
      if (tEntry) {
        const fLower: Record<string, string> = {};
        for (const [k, v] of Object.entries(tEntry.map)) fLower[k.toLowerCase()] = v;
        currentFieldId = tEntry.map[key] ?? fLower[key.toLowerCase()];
      }

      const candidate = currentFieldId ? candidates.find((c) => c.id === currentFieldId) : undefined;
      const status: FieldMappingEntry["status"] = !currentFieldId
        ? "missing"
        : candidate
          ? "mapped"
          : "stale";

      return {
        table,
        tableLabel,
        key,
        expectedLabel: label,
        hint,
        isOptional,
        currentFieldId,
        currentFieldName: candidate?.name,
        status,
        candidates,
      };
    };

    const required: FieldMappingEntry[] = [];
    for (const t of REQUIRED_SCHEMA) {
      for (const f of t.fields) {
        required.push(buildEntry(t.table, t.label, f.key, f.label, f.hint, false));
      }
    }
    const optional: FieldMappingEntry[] = OPTIONAL_FIELDS.map((o) =>
      buildEntry(o.table, o.table, o.key, o.label, o.hint, true),
    );

    return { hasOverride: true, baseId: cfg.baseId, required, optional };
  });
