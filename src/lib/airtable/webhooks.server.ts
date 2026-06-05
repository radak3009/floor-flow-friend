/**
 * Airtable webhooks: registracija + MAC verifikacija + payload consumption.
 *
 * Tok:
 *  1) `registerWebhook` poziva Airtable API `POST /v0/bases/{baseId}/webhooks`
 *     i čuva {id, macSecret, tableId} u `airtable_config.webhooks`.
 *  2) Airtable šalje POST notifikaciju (samo "nešto se promenilo") na našu
 *     javnu rutu uz `X-Airtable-Content-MAC` header.
 *  3) Mi verifikujemo MAC, invalidiramo deljeni keš (i opciono drain-ujemo
 *     payload kroz `consumePayloads` da označimo cursor).
 *
 * Dokumentacija: https://airtable.com/developers/web/api/webhooks-overview
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadActiveConfig } from "./config.server";
import { AIRTABLE_BASE_ID } from "./schema";

const AIRTABLE_DIRECT = "https://api.airtable.com";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/airtable";

type StoredWebhook = {
  id: string;
  macSecret: string;
  tableId: string;
  notificationUrl: string;
  createdAt: string;
};

type WebhooksMap = Record<string, StoredWebhook>;

async function authHeaders(): Promise<{ url: string; headers: Record<string, string> }> {
  const cfg = await loadActiveConfig();
  if (cfg?.pat) {
    return {
      url: AIRTABLE_DIRECT,
      headers: {
        Authorization: `Bearer ${cfg.pat}`,
        "Content-Type": "application/json",
      },
    };
  }
  const lov = process.env.LOVABLE_API_KEY;
  const at = process.env.AIRTABLE_API_KEY;
  if (!lov || !at) throw new Error("Airtable credentials nisu konfigurisani");
  return {
    url: GATEWAY_URL,
    headers: {
      Authorization: `Bearer ${lov}`,
      "X-Connection-Api-Key": at,
      "Content-Type": "application/json",
    },
  };
}

async function activeBaseId(): Promise<string> {
  const cfg = await loadActiveConfig();
  return cfg?.baseId ?? AIRTABLE_BASE_ID;
}

async function loadWebhooks(): Promise<WebhooksMap> {
  const { data } = await supabaseAdmin
    .from("airtable_config")
    .select("webhooks")
    .eq("id", "active")
    .maybeSingle();
  return ((data?.webhooks as WebhooksMap | null) ?? {}) as WebhooksMap;
}

async function saveWebhooks(map: WebhooksMap): Promise<void> {
  await supabaseAdmin
    .from("airtable_config")
    .update({ webhooks: map as any, updated_at: new Date().toISOString() })
    .eq("id", "active");
}

export async function getWebhookByKey(key: string): Promise<StoredWebhook | undefined> {
  const map = await loadWebhooks();
  return map[key];
}

export interface RegisterInput {
  key: string; // logical name e.g. "monitoring"
  tableId: string; // Airtable tblXXX
  notificationUrl: string; // public callback URL
}

export async function registerWebhook(input: RegisterInput): Promise<StoredWebhook> {
  const baseId = await activeBaseId();
  const { url, headers } = await authHeaders();

  // Idempotentno: ako već postoji u našoj mapi, vrati ga.
  const existing = await loadWebhooks();
  if (existing[input.key]) return existing[input.key];

  const body = {
    notificationUrl: input.notificationUrl,
    specification: {
      options: {
        filters: {
          dataTypes: ["tableData"],
          recordChangeScope: input.tableId,
        },
      },
    },
  };

  const res = await fetch(`${url}/v0/bases/${baseId}/webhooks`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Airtable webhook create failed: ${res.status} ${text.slice(0, 500)}`);
  }
  const parsed = JSON.parse(text) as { id: string; macSecretBase64: string };

  const stored: StoredWebhook = {
    id: parsed.id,
    macSecret: parsed.macSecretBase64,
    tableId: input.tableId,
    notificationUrl: input.notificationUrl,
    createdAt: new Date().toISOString(),
  };
  const merged = { ...existing, [input.key]: stored };
  await saveWebhooks(merged);
  return stored;
}

export async function deleteWebhook(key: string): Promise<void> {
  const baseId = await activeBaseId();
  const { url, headers } = await authHeaders();
  const map = await loadWebhooks();
  const hook = map[key];
  if (!hook) return;
  try {
    await fetch(`${url}/v0/bases/${baseId}/webhooks/${hook.id}`, { method: "DELETE", headers });
  } catch (e) {
    console.warn("Airtable webhook delete (remote) failed:", e);
  }
  const next = { ...map };
  delete next[key];
  await saveWebhooks(next);
}

export async function listRegisteredWebhooks(): Promise<Array<{ key: string } & StoredWebhook>> {
  const map = await loadWebhooks();
  return Object.entries(map).map(([key, v]) => ({ key, ...v }));
}

/**
 * Verify Airtable MAC. Spec: HMAC-SHA256 over the raw request body using the
 * macSecretBase64 returned at webhook creation; header value is
 * `hmac-sha256=<base64>` u `X-Airtable-Content-MAC`.
 */
export async function verifyMac(rawBody: string, header: string | null, macSecretBase64: string): Promise<boolean> {
  if (!header) return false;
  const expected = await computeHmacBase64(rawBody, macSecretBase64);
  const sent = header.startsWith("hmac-sha256=") ? header.slice("hmac-sha256=".length) : header;
  return timingSafeEqual(sent, expected);
}

async function computeHmacBase64(message: string, keyBase64: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message) as BufferSource);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
