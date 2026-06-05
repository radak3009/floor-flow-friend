/**
 * Server-only helper for runtime Airtable override config.
 * Stores Base ID + encrypted PAT + regenerated TABLES/FIELDS maps in Lovable Cloud.
 * Never imported from client code.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ActiveAirtableConfig {
  baseId: string;
  pat: string;
  tables: Record<string, string> | null;
  fields: Record<string, Record<string, string>> | null;
  updatedBy: string | null;
  updatedAt: string;
  finalized: boolean;
}

const ROW_ID = "active";
const CACHE_TTL_MS = 60_000;
let cache: { at: number; value: ActiveAirtableConfig | null } | null = null;
let inflightLoad: Promise<ActiveAirtableConfig | null> | null = null;


function getKey(): Promise<CryptoKey> {
  const raw = process.env.AIRTABLE_CONFIG_KEY;
  if (!raw) throw new Error("AIRTABLE_CONFIG_KEY is not configured");
  const trimmed = raw.trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    throw new Error(
      "AIRTABLE_CONFIG_KEY is not valid base64. Generate with: openssl rand -base64 32",
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0));
  } catch {
    throw new Error(
      "AIRTABLE_CONFIG_KEY failed to decode. Must be base64 of 32 random bytes (openssl rand -base64 32).",
    );
  }
  if (bytes.byteLength !== 32) {
    throw new Error(
      `AIRTABLE_CONFIG_KEY must decode to exactly 32 bytes (got ${bytes.byteLength}). Use: openssl rand -base64 32`,
    );
  }
  return crypto.subtle.importKey("raw", bytes as BufferSource, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function encryptPat(plain: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plain);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, enc as BufferSource);
  return { ciphertext: b64encode(ct), iv: b64encode(iv) };
}

async function decryptPat(ciphertext: string, iv: string): Promise<string> {
  const key = await getKey();
  const ct = b64decode(ciphertext);
  const ivBytes = b64decode(iv);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes as BufferSource }, key, ct as BufferSource);
  return new TextDecoder().decode(pt);
}

export function invalidateConfigCache(): void {
  cache = null;
  inflightLoad = null;
}

export async function loadActiveConfig(): Promise<ActiveAirtableConfig | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflightLoad) return inflightLoad;

  inflightLoad = (async (): Promise<ActiveAirtableConfig | null> => {
    try {
      const ts = Date.now();
      const { data, error } = await supabaseAdmin
        .from("airtable_config")
        .select("*")
        .eq("id", ROW_ID)
        .maybeSingle();
      if (error) {
        console.error("[airtable_config] load failed:", error);
        cache = { at: ts, value: null };
        return null;
      }
      if (!data) {
        cache = { at: ts, value: null };
        return null;
      }
      try {
        const pat = await decryptPat(data.pat_encrypted, data.pat_iv);
        const value: ActiveAirtableConfig = {
          baseId: data.base_id,
          pat,
          tables: (data.tables as any) ?? null,
          fields: (data.fields as any) ?? null,
          updatedBy: data.updated_by,
          updatedAt: data.updated_at,
          finalized: (data as any).finalized === true,
        };
        cache = { at: ts, value };
        return value;
      } catch (e) {
        console.error("[airtable_config] decrypt failed:", e);
        cache = { at: ts, value: null };
        return null;
      }
    } finally {
      inflightLoad = null;
    }
  })();

  return inflightLoad;
}

export interface ConfigStatus {
  hasOverride: boolean;
  baseId: string | null;
  hasTablesMap: boolean;
  hasFieldsMap: boolean;
  tablesCount: number;
  fieldsCount: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export async function getConfigStatus(): Promise<ConfigStatus> {
  const cfg = await loadActiveConfig();
  if (!cfg) {
    return {
      hasOverride: false,
      baseId: null,
      hasTablesMap: false,
      hasFieldsMap: false,
      tablesCount: 0,
      fieldsCount: 0,
      updatedBy: null,
      updatedAt: null,
    };
  }
  const tablesCount = cfg.tables ? Object.keys(cfg.tables).length : 0;
  let fieldsCount = 0;
  if (cfg.fields) {
    for (const m of Object.values(cfg.fields)) fieldsCount += Object.keys(m).length;
  }
  return {
    hasOverride: true,
    baseId: cfg.baseId,
    hasTablesMap: tablesCount > 0,
    hasFieldsMap: fieldsCount > 0,
    tablesCount,
    fieldsCount,
    updatedBy: cfg.updatedBy,
    updatedAt: cfg.updatedAt,
  };
}

export async function saveActiveConfig(input: {
  baseId: string;
  pat: string;
  updatedBy: string;
}): Promise<void> {
  const { ciphertext, iv } = await encryptPat(input.pat);
  // preserve existing tables/fields if present
  const existing = await supabaseAdmin
    .from("airtable_config")
    .select("tables, fields")
    .eq("id", ROW_ID)
    .maybeSingle();
  const { error } = await supabaseAdmin.from("airtable_config").upsert({
    id: ROW_ID,
    base_id: input.baseId,
    pat_encrypted: ciphertext,
    pat_iv: iv,
    tables: existing.data?.tables ?? null,
    fields: existing.data?.fields ?? null,
    updated_by: input.updatedBy,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Save config failed: ${error.message}`);
  invalidateConfigCache();
}

export async function saveSchemaMaps(input: {
  tables: Record<string, string>;
  fields: Record<string, Record<string, string>>;
  updatedBy: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("airtable_config")
    .update({
      tables: input.tables,
      fields: input.fields,
      updated_by: input.updatedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ROW_ID);
  if (error) throw new Error(`Save schema maps failed: ${error.message}`);
  invalidateConfigCache();
}

export async function finalizeConfig(updatedBy: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("airtable_config")
    .update({
      finalized: true,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", ROW_ID);
  if (error) throw new Error(`Finalize config failed: ${error.message}`);
  invalidateConfigCache();
}

export async function clearActiveConfig(): Promise<void> {
  const { error } = await supabaseAdmin.from("airtable_config").delete().eq("id", ROW_ID);
  if (error) throw new Error(`Clear config failed: ${error.message}`);
  invalidateConfigCache();
}
