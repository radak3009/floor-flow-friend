/**
 * Airtable SDK shim — provides Zite-SDK-compatible surface
 * (Table.findAll / findOne / create / update) on top of the Lovable
 * Airtable connector gateway. SERVER ONLY.
 *
 * Supports runtime override (different Base ID / PAT) when an `airtable_config`
 * row exists in Lovable Cloud. In that mode requests go directly to
 * api.airtable.com with the stored PAT. Otherwise falls back to the Lovable
 * connector gateway + static schema.ts.
 */
import { AIRTABLE_BASE_ID, TABLES as STATIC_TABLES, FIELDS as STATIC_FIELDS, type TableName } from "./schema";
import type { RecordOf, TypedFilters, WritePayload, SortSpec, FilterValue } from "./types";
export type { TypedFilters, WritePayload, SortSpec, RecordOf } from "./types";
import { loadActiveConfig } from "./config.server";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/airtable";
const AIRTABLE_DIRECT = "https://api.airtable.com";

// Fail-fast budget per Airtable request. If Airtable / gateway hangs,
// abort and let the retry loop (or the caller) react quickly rather than
// stalling SSR / server fn for the full Worker timeout.
const FAIL_FAST_TIMEOUT_MS = 30_000;

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error(`Airtable request timeout after ${ms}ms`)), ms);
  return controller.signal;
}

type FieldMap = Record<string, string>; // camelCase -> fldXXX
type ReverseMap = Record<string, string>; // fldXXX -> camelCase

interface ActiveContext {
  mode: "direct" | "gateway";
  baseId: string;
  pat?: string; // direct mode only
  tables: Record<string, string>;
  fields: Record<string, Record<string, string>>;
}

function lookupCaseInsensitive<T>(map: Record<string, T>, key: string): T | undefined {
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  const lower = key.toLowerCase();
  const actualKey = Object.keys(map).find((k) => k.toLowerCase() === lower);
  return actualKey ? map[actualKey] : undefined;
}

function tableIdForCtx(ctx: ActiveContext, table: TableName): string | undefined {
  return lookupCaseInsensitive(ctx.tables, table);
}

function fieldMapForCtx(ctx: ActiveContext, table: TableName): FieldMap | undefined {
  return lookupCaseInsensitive(ctx.fields, table);
}

function fieldIdForCtx(ctx: ActiveContext, table: TableName, camel: string): string | undefined {
  const fm = fieldMapForCtx(ctx, table);
  return fm ? lookupCaseInsensitive(fm, camel) : undefined;
}

/**
 * Alias-i: codeKey (ono što očekuje aplikacioni kod) → airtableLabelKey
 * (camelCase koji regen napravi iz Airtable LABELE polja).
 *
 * Field ID-evi se menjaju kada korisnik remiksuje bazu, pa NE smemo da se
 * oslanjamo na njih. Labels u Airtable-u su stabilne, pa mapiramo po nazivu:
 * regen već generiše `toCamel(label)` ključeve, a ovde aliasiramo
 * codeKey → labelKey tamo gde se razlikuju (npr. code "kupac" ↔ label
 * "Naručilac" → "narucilac"). Identity unosi su zaštita ako neko menja kod.
 */
const FIELD_ALIASES: Partial<Record<TableName, Record<string, string>>> = {
  // RadniNalozi: u nekim bazama je link na artikal nazvan "proizvod" (label
  // "Proizvod") umesto "artikal" → alias da kod koji koristi `rn.artikal`
  // i dalje radi.
  RadniNalozi: {
    kupac: "narucilac",
    masaKomadaKg: "masaKomadaG",
    masaKomadaG: "masaKomadaKg",
    artikal: "proizvod",
    proizvod: "artikal",
  },
  Zastoji: { idZapisa: "idZapisa" },
  PromeneNaloga: {
    artikal: "artikal",
    idZapisa: "idZapisa",
    opcija: "opcije",
    opcije: "opcija",
    kreiraola: "kreiraoLa",
    kreiraoLa: "kreiraola",
  },
  // Airtable label "Uređaj" → različite camelCase verzije ovisno o regen-u:
  // "ureaj" (stripping diakritika) ili "uredjaj" (translit). Aliasi ispod
  // garantuju da code-key "ureaj" radi u oba slučaja.
  PrijaveNaSistem: { ureaj: "uredjaj", uredjaj: "ureaj" },
  // Regen pravi camelKey iz labele "Procenjeno trajanje (d:h:min)" →
  // `procenjenoTrajanjeDHMin` (velika H/M), dok kod koristi
  // `procenjenoTrajanjeDhmin`. Isto i za trajanjeZastoja(H:min) i
  // energija(KwH). Aliasi ispod podržavaju oba pravca. Takođe: u nekim
  // bazama je "Naziv mašine/linije" mapiran samo kao `naziv` — alias
  // `nazivLinije ↔ naziv` čuva legacy code-key.
  Monitoring: {
    nazivLinije: "naziv",
    naziv: "nazivLinije",
    procenjenoTrajanjeDhmin: "procenjenoTrajanjeDHMin",
    procenjenoTrajanjeDHMin: "procenjenoTrajanjeDhmin",
    procenjenoTrajanjeHmin: "procenjenoTrajanjeHMin",
    procenjenoTrajanjeHMin: "procenjenoTrajanjeHmin",
    trajanjeZastojaHmin: "trajanjeZastojaHMin",
    trajanjeZastojaHMin: "trajanjeZastojaHmin",
    energijaProizvodnjaKwh: "energijaProizvodnjaKwH",
    energijaProizvodnjaKwH: "energijaProizvodnjaKwh",
    energijaZastojiKwh: "energijaZastojiKwH",
    energijaZastojiKwH: "energijaZastojiKwh",
    potrosnjaUTokuZastojaKwh: "potrosnjaUTokuZastojaKwH",
    potrosnjaUTokuZastojaKwH: "potrosnjaUTokuZastojaKwh",
    nerasporeeniCiklusi: "nerasporedjeniCiklusi",
    nerasporedjeniCiklusi: "nerasporeeniCiklusi",
  },
};

function applyAliases(fields: Record<string, Record<string, string>>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  // Indeks aliasa po lowercase imenu tabele — runtime config koristi
  // camelCase ("prijaveNaSistem"), dok je FIELD_ALIASES PascalCase.
  const aliasesByLower: Record<string, Record<string, string>> = {};
  for (const [t, a] of Object.entries(FIELD_ALIASES)) {
    if (a) aliasesByLower[t.toLowerCase()] = a;
  }
  for (const [table, fm] of Object.entries(fields)) {
    const merged = { ...fm };
    const aliases = aliasesByLower[table.toLowerCase()];
    if (aliases) {
      for (const [codeKey, labelKey] of Object.entries(aliases)) {
        const fid = lookupCaseInsensitive(fm, labelKey) ?? lookupCaseInsensitive(fm, codeKey);
        if (fid && !Object.prototype.hasOwnProperty.call(merged, codeKey)) {
          merged[codeKey] = fid;
        }
      }
    }
    out[table] = merged;
  }
  return out;
}

async function getContext(): Promise<ActiveContext> {
  const cfg = await loadActiveConfig();
  if (cfg && cfg.tables && cfg.fields && Object.keys(cfg.tables).length > 0) {
    return {
      mode: "direct",
      baseId: cfg.baseId,
      pat: cfg.pat,
      tables: cfg.tables,
      fields: applyAliases(cfg.fields),
    };
  }
  if (cfg && (!cfg.tables || !cfg.fields)) {
    return {
      mode: "direct",
      baseId: cfg.baseId,
      pat: cfg.pat,
      tables: STATIC_TABLES as unknown as Record<string, string>,
      fields: applyAliases(STATIC_FIELDS as unknown as Record<string, Record<string, string>>),
    };
  }
  return {
    mode: "gateway",
    baseId: AIRTABLE_BASE_ID,
    tables: STATIC_TABLES as unknown as Record<string, string>,
    fields: applyAliases(STATIC_FIELDS as unknown as Record<string, Record<string, string>>),
  };
}

function reverseMap(fm: FieldMap): ReverseMap {
  const r: ReverseMap = {};
  for (const [k, v] of Object.entries(fm)) r[v] = k;
  return r;
}

// Public filter shape — re-exported as `TypedFilters<T>` per-table.
// Keep the loose Filters type for internal helpers (buildOp/buildFormula).
export type { FilterValue, FilterOps } from "./types";
export type Filters = Record<string, FilterValue>;

function esc(v: string): string {
  return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function lit(v: string | number | boolean): string {
  if (typeof v === "string") return esc(v);
  if (typeof v === "boolean") return v ? "TRUE()" : "FALSE()";
  return String(v);
}

function fieldRefForCtx(ctx: ActiveContext, table: TableName, camel: string): string {
  if (camel === "recordId") return "RECORD_ID()";
  const id = fieldIdForCtx(ctx, table, camel);
  if (!id) throw new Error(`Unknown field "${camel}" on table "${table}"`);
  return `{${id}}`;
}

function buildOp(ctx: ActiveContext, table: TableName, camel: string, val: FilterValue): string {
  const ref = fieldRefForCtx(ctx, table, camel);
  if (val === null || val === undefined) return `OR(${ref} = BLANK(), NOT(${ref}))`;
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return `${ref} = ${lit(val)}`;
  }
  const clauses: string[] = [];
  if (val.equals !== undefined) clauses.push(`${ref} = ${lit(val.equals)}`);
  if (val.in) {
    if (val.in.length === 0) clauses.push("FALSE()");
    else clauses.push(`OR(${val.in.map((x) => `${ref} = ${lit(x)}`).join(",")})`);
  }
  if (val.notIn) {
    if (val.notIn.length === 0) clauses.push("TRUE()");
    else clauses.push(`NOT(OR(${val.notIn.map((x) => `${ref} = ${lit(x)}`).join(",")}))`);
  }
  if (val.not !== undefined) {
    if (typeof val.not === "boolean") clauses.push(`NOT(${ref})`);
    else if (val.not === null) clauses.push(`NOT(OR(${ref} = BLANK(), NOT(${ref})))`);
    else clauses.push(`${ref} != ${lit(val.not as string | number | boolean)}`);
  }
  if (val.gte !== undefined) clauses.push(`${ref} >= ${lit(val.gte)}`);
  if (val.lte !== undefined) clauses.push(`${ref} <= ${lit(val.lte)}`);
  if (val.gt !== undefined) clauses.push(`${ref} > ${lit(val.gt)}`);
  if (val.lt !== undefined) clauses.push(`${ref} < ${lit(val.lt)}`);
  if (val.contains !== undefined) clauses.push(`SEARCH(${lit(val.contains)}, ${ref}&"")`);
  if (val.linkAnyOf) {
    if (val.linkAnyOf.length === 0) clauses.push("FALSE()");
    else {
      // Airtable's ARRAYJOIN on a linked field returns the *display* (primary)
      // values, NOT the record IDs. Callers must pass the linked records'
      // primary-field values here. We use a "|" delimiter on both sides to
      // avoid false substring matches (e.g. "RN-1" matching "RN-10").
      const joined = `("|" & ARRAYJOIN(${ref}, "|") & "|")`;
      clauses.push(
        `OR(${val.linkAnyOf.map((x) => `FIND(${lit(`|${x}|`)}, ${joined})>0`).join(",")})`
      );
    }
  }
  if (val.isEmpty === true) clauses.push(`OR(${ref} = BLANK(), NOT(${ref}))`);
  if (val.isEmpty === false) clauses.push(`NOT(OR(${ref} = BLANK(), NOT(${ref})))`);
  return clauses.length === 1 ? clauses[0] : `AND(${clauses.join(",")})`;
}

function buildFormula(ctx: ActiveContext, table: TableName, filters: Filters): string | undefined {
  const keys = Object.keys(filters);
  if (keys.length === 0) return undefined;
  // Tihi skip filtera za polja koja ne postoje u trenutnoj šemi (remix-friendly).
  // Npr. `deleted` ne mora postojati u remixovanoj bazi — bolje da filter bude no-op
  // nego da ceo upit pukne.
  const validKeys = keys.filter((k) => {
    if (k === "recordId") return true;
    if (fieldIdForCtx(ctx, table, k)) return true;
    console.warn(`[airtable-sdk] Filter polje "${k}" ne postoji na tabeli "${table}" — preskačem.`);
    return false;
  });
  if (validKeys.length === 0) return undefined;
  const parts = validKeys.map((k) => buildOp(ctx, table, k, filters[k]));
  return parts.length === 1 ? parts[0] : `AND(${parts.join(",")})`;
}


// ---------- Record translation ----------
function fromAirtable<T = Record<string, any>>(ctx: ActiveContext, table: TableName, rec: { id: string; fields: Record<string, any>; createdTime?: string }): T & { id: string } {
  const fm = fieldMapForCtx(ctx, table) ?? {};
  const rev = reverseMap(fm); // fldXXX -> camelKey (uključujući alias codeKeys preko applyAliases)
  const out: Record<string, any> = { id: rec.id };
  for (const [fid, val] of Object.entries(rec.fields)) {
    // Postavi pod SVAKIM camelKey-em koji pokazuje na ovaj fid (alias + label key).
    let matched = false;
    for (const [camel, mappedFid] of Object.entries(fm)) {
      if (mappedFid === fid) {
        out[camel] = val;
        matched = true;
      }
    }
    if (!matched) {
      const camel = rev[fid];
      if (camel) out[camel] = val;
      else out[fid] = val;
    }
  }
  return out as T & { id: string };
}

function toAirtable(ctx: ActiveContext, table: TableName, partial: Record<string, any>): Record<string, any> {
  const fm = fieldMapForCtx(ctx, table);
  if (!fm) throw new Error(`Unknown table "${table}"`);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(partial)) {
    // __extraFields: passthrough keyed by raw Airtable field name (ili ID).
    // Koristi se za polja van statičke schema mape (npr. clientOpId za outbox dedupe).
    if (k === "__extraFields" && v && typeof v === "object") {
      for (const [rk, rv] of Object.entries(v as Record<string, any>)) {
        if (rv !== undefined) out[rk] = rv;
      }
      continue;
    }
    const fid = lookupCaseInsensitive(fm, k);
    if (!fid) throw new Error(`Unknown field "${k}" on table "${table}"`);
    out[fid] = v;
  }
  return out;
}

/**
 * Niži-nivo Airtable fetch — koristi se za upite van statičke schema mape
 * (npr. dedupe po `clientOpId` kojeg nemamo u FIELDS).
 */
export async function rawAirtableRequest(path: string, init: RequestInit = {}): Promise<any> {
  const ctx = await getContext();
  return airtableFetch(ctx, path, init);
}

export async function getActiveBaseAndTable(table: TableName): Promise<{ baseId: string; tableId: string }> {
  const ctx = await getContext();
  const tableId = tableIdForCtx(ctx, table);
  if (!tableId) throw new Error(`Unknown table "${table}" in active Airtable config`);
  return { baseId: ctx.baseId, tableId };
}

// ---------- Throttle ----------
const TB_MIN_INTERVAL_MS = 250;
let tbNextSlotAt = 0;

function tbAcquire(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, tbNextSlotAt);
  tbNextSlotAt = slot + TB_MIN_INTERVAL_MS;
  const wait = slot - now;
  if (wait <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, wait));
}

// ---------- Core requests ----------
function buildHeaders(ctx: ActiveContext): Record<string, string> {
  if (ctx.mode === "direct") {
    if (!ctx.pat) throw new Error("PAT missing in direct mode");
    return {
      Authorization: `Bearer ${ctx.pat}`,
      "Content-Type": "application/json",
    };
  }
  const lov = process.env.LOVABLE_API_KEY;
  const at = process.env.AIRTABLE_API_KEY;
  if (!lov) throw new Error("LOVABLE_API_KEY is not configured");
  if (!at) throw new Error("AIRTABLE_API_KEY is not configured (link Airtable connector)");
  return {
    Authorization: `Bearer ${lov}`,
    "X-Connection-Api-Key": at,
    "Content-Type": "application/json",
  };
}

async function airtableFetch(ctx: ActiveContext, path: string, init: RequestInit = {}): Promise<any> {
  const base = ctx.mode === "direct" ? AIRTABLE_DIRECT : GATEWAY_URL;
  const url = `${base}${path}`;
  const method = String(init.method ?? "GET").toUpperCase();
  const maxAttempts = 5;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await tbAcquire();
      const res = await fetch(url, {
        ...init,
        signal: init.signal ?? timeoutSignal(FAIL_FAST_TIMEOUT_MS),
        headers: { ...buildHeaders(ctx), ...(init.headers as any) },
      });
      const text = await res.text();
      if (!res.ok) {
        if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxAttempts) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30_000)
            : 300 * 2 ** (attempt - 1);
          if (res.status === 429) {
            console.warn(`[airtable] 429 rate-limit on ${path}, waiting ${waitMs}ms (attempt ${attempt}/${maxAttempts})`);
          }
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`Airtable ${ctx.mode} ${res.status} ${path}: ${text.slice(0, 500)}`);
      }
      return text ? JSON.parse(text) : null;
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && (err.name === "AbortError" || /timeout/i.test(err.message))) {
        console.warn(`[airtable] fail-fast timeout on ${method} ${path} (attempt ${attempt}/${maxAttempts})`);
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ---------- Table proxy ----------
export interface FindAllOpts<T extends TableName = TableName> {
  filters?: TypedFilters<T>;
  limit?: number;
  sort?: Array<SortSpec<T>>;
}

function makeTable<T extends TableName>(table: T) {
  type Row = RecordOf<T>;
  return {
    async findAll(opts: FindAllOpts<T> = {}): Promise<{ records: Row[] }> {
      const ctx = await getContext();
      const tableId = tableIdForCtx(ctx, table);
      if (!tableId) throw new Error(`Unknown table "${table}" in active Airtable config`);
      const cap = opts.limit ?? 100;
      const params = new URLSearchParams();
      params.set("returnFieldsByFieldId", "true");
      params.set("pageSize", String(Math.min(100, cap)));
      const formula = opts.filters ? buildFormula(ctx, table, opts.filters as Filters) : undefined;
      if (formula) params.set("filterByFormula", formula);
      if (opts.sort) {
        opts.sort.forEach((s, i) => {
          const fid = fieldIdForCtx(ctx, table, s.field as string);
          if (!fid) return;
          params.set(`sort[${i}][field]`, fid);
          if (s.direction) params.set(`sort[${i}][direction]`, s.direction);
        });
      }
      const out: Row[] = [];
      let offset: string | undefined;
      do {
        const qp = new URLSearchParams(params);
        if (offset) qp.set("offset", offset);
        const data = await airtableFetch(ctx, `/v0/${ctx.baseId}/${tableId}?${qp.toString()}`);
        for (const r of data.records || []) {
          out.push(fromAirtable<Row>(ctx, table, r));
          if (out.length >= cap) break;
        }
        offset = data.offset;
      } while (offset && out.length < cap);
      return { records: out };
    },

    async findOne({ id }: { id: string }): Promise<Row | null> {
      const ctx = await getContext();
      const tableId = tableIdForCtx(ctx, table);
      if (!tableId) throw new Error(`Unknown table "${table}" in active Airtable config`);
      const data = await airtableFetch(ctx, `/v0/${ctx.baseId}/${tableId}/${encodeURIComponent(id)}?returnFieldsByFieldId=true`);
      if (!data || !data.id) return null;
      return fromAirtable<Row>(ctx, table, data);
    },

    async create({ record }: { record: WritePayload<T> }): Promise<Row> {
      const ctx = await getContext();
      const tableId = tableIdForCtx(ctx, table);
      if (!tableId) throw new Error(`Unknown table "${table}" in active Airtable config`);
      const fields = toAirtable(ctx, table, record as Record<string, any>);
      const data = await airtableFetch(ctx, `/v0/${ctx.baseId}/${tableId}?returnFieldsByFieldId=true`, {
        method: "POST",
        body: JSON.stringify({ fields, typecast: true }),
      });
      return fromAirtable<Row>(ctx, table, data);
    },

    async update({ id, record }: { id: string; record: WritePayload<T> }): Promise<Row> {
      const ctx = await getContext();
      const tableId = tableIdForCtx(ctx, table);
      if (!tableId) throw new Error(`Unknown table "${table}" in active Airtable config`);
      const fields = toAirtable(ctx, table, record as Record<string, any>);
      const data = await airtableFetch(ctx, `/v0/${ctx.baseId}/${tableId}/${encodeURIComponent(id)}?returnFieldsByFieldId=true`, {
        method: "PATCH",
        body: JSON.stringify({ fields, typecast: true }),
      });
      return fromAirtable<Row>(ctx, table, data);
    },
  };
}

// Named exports — match Zite SDK names
export const Monitoring = makeTable("Monitoring");
export const RadniNalozi = makeTable("RadniNalozi");
export const Artikli = makeTable("Artikli");
export const Resursi = makeTable("Resursi");
export const KontaktOsobe = makeTable("KontaktOsobe");
export const Role = makeTable("Role");
export const PrijaveNaSistem = makeTable("PrijaveNaSistem");
export const PromeneNaloga = makeTable("PromeneNaloga");
export const Zastoji = makeTable("Zastoji");
export const Grupe = makeTable("Grupe");
export const Tipovi = makeTable("Tipovi");
export const Komitenti = makeTable("Komitenti");
export const Materijali = makeTable("Materijali");
// `Inspekcija` tabela ne postoji u remixovanoj bazi — inspekcije se vode u
// `PromeneNaloga` sa `tipZapisa = "Inspekcija"`. Vidi src/lib/api/inspection.functions.ts.

/**
 * Resolve the current Airtable field ID for a camelCase key under the active config.
 * Use this when you need a raw field ID at call sites (e.g. attachment upload),
 * so that overriding to a different base picks up the new IDs.
 */
export async function resolveFieldId(table: TableName, camel: string): Promise<string> {
  const ctx = await getContext();
  const fm = (ctx.fields as any)[table] as FieldMap | undefined;
  const id = fm?.[camel];
  if (!id) throw new Error(`Unknown field "${camel}" on table "${table}" in active config`);
  return id;
}


// ---------- Attachment upload ----------
export async function uploadAttachment(opts: {
  recordId: string;
  fieldId: string;
  filename: string;
  contentType: string;
  fileBase64: string;
}): Promise<void> {
  const ctx = await getContext();
  const token =
    ctx.mode === "direct" ? ctx.pat! : process.env.AIRTABLE_API_KEY;
  if (!token) throw new Error("Airtable token not configured");
  const url = `https://content.airtable.com/v0/${ctx.baseId}/${opts.recordId}/${opts.fieldId}/uploadAttachment`;
  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: timeoutSignal(FAIL_FAST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentType: opts.contentType,
          filename: opts.filename,
          file: opts.fileBase64,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        const transient = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
        if (transient && attempt < maxAttempts) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30_000)
            : 500 * 2 ** (attempt - 1);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`Airtable upload ${res.status}: ${text.slice(0, 500)}`);
      }
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
