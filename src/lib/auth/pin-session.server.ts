/**
 * HMAC-potpisan session token za PIN korisnike (server-only).
 *
 * Token format (kompaktan): base64url(payloadJson) + "." + base64url(hmacSha256)
 *
 * `SESSION_SIGNING_SECRET` se preferira; ako nije postavljen, koristi se
 * `SUPABASE_SERVICE_ROLE_KEY` (već postoji, server-only) kao fallback.
 */

import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

const TOKEN_TTL_SEC = 12 * 60 * 60; // 12h

export interface PinSessionPayload {
  userId: string;
  roleId: string;
  prijavaId?: string;
  iat: number;
  exp: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function secret(): string {
  const s = process.env.SESSION_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("SESSION_SIGNING_SECRET (ili SUPABASE_SERVICE_ROLE_KEY) nije postavljen");
  return s;
}

async function hmac(payloadBytes: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes as BufferSource);
  return new Uint8Array(sig);
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signSession(params: { userId: string; roleId: string; prijavaId?: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: PinSessionPayload = {
    userId: params.userId,
    roleId: params.roleId,
    prijavaId: params.prijavaId,
    iat: now,
    exp: now + TOKEN_TTL_SEC,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await hmac(payloadBytes);
  return `${b64urlEncode(payloadBytes)}.${b64urlEncode(sig)}`;
}

/**
 * Verifikuje token uz dozvoljen "grace" period nakon isteka (za sliding
 * refresh): potpis MORA biti validan (dokaz da je token legitimno izdat),
 * a `exp` sme biti u prošlosti najviše `graceSec` sekundi.
 */
export async function verifySessionAllowExpired(
  token: string,
  graceSec: number,
): Promise<PinSessionPayload | null> {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = b64urlDecode(token.slice(0, dot));
    sigBytes = b64urlDecode(token.slice(dot + 1));
  } catch {
    return null;
  }
  const expected = await hmac(payloadBytes);
  if (!timingSafeEqualBytes(expected, sigBytes)) return null;
  let payload: PinSessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== "number" || typeof payload.userId !== "string" || !payload.userId) return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp + graceSec) return null;
  return payload;
}

/* Čita PIN session token iz zaglavlja zahteva (X-PIN-Session ili Authorization). */
export function readPinSessionToken(headers: Headers | undefined | null): string {
  const auth = headers?.get("x-pin-session") ?? headers?.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : auth;
}

export async function verifySession(token: string): Promise<PinSessionPayload | null> {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = b64urlDecode(token.slice(0, dot));
    sigBytes = b64urlDecode(token.slice(dot + 1));
  } catch {
    return null;
  }
  const expected = await hmac(payloadBytes);
  if (!timingSafeEqualBytes(expected, sigBytes)) return null;
  let payload: PinSessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== "number") return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

/**
 * Server fn middleware koji zahteva validan PIN session token u
 * `Authorization: Bearer ...` zaglavlju i u kontekst stavlja `pin` polje
 * sa userId / roleId / prijavaId. Poslovne funkcije moraju koristiti
 * `context.pin.userId` umesto `data.userId`.
 */
export const requirePinSession = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const req = getRequest();
  const token = readPinSessionToken(req?.headers);
  const payload = await verifySession(token);
  if (!payload) {
    throw new Error("Unauthorized: nevažeća ili istekla sesija");
  }
  return next({
    context: {
      pin: {
        userId: payload.userId,
        roleId: payload.roleId,
        prijavaId: payload.prijavaId,
      },
    },
  });
});
