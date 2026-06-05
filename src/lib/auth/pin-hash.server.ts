/**
 * PBKDF2-SHA256 hashing za PIN. Web Crypto, bez dodatnih zavisnosti.
 * Format: pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>
 */

const ITERATIONS = 100_000; // Cloudflare Workers max za PBKDF2
const MAX_SUPPORTED_ITERATIONS = 100_000;
const SALT_LEN = 16;
const KEY_LEN = 32;
const PREFIX = "pbkdf2$sha256$";

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveBits(pin: string, salt: Uint8Array, iterations: number, keyLen: number): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    keyLen * 8,
  );
  return new Uint8Array(bits);
}

export function isHashed(stored: string): boolean {
  return typeof stored === "string" && stored.startsWith(PREFIX);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const hash = await deriveBits(pin, salt, ITERATIONS, KEY_LEN);
  return `${PREFIX}${ITERATIONS}$${b64encode(salt)}$${b64encode(hash)}`;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const av = enc.encode(a);
  const bv = enc.encode(b);
  // Pad shorter da bi se i dužina sakrila koliko god moguće
  const len = Math.max(av.length, bv.length);
  const pa = new Uint8Array(len);
  const pb = new Uint8Array(len);
  pa.set(av);
  pb.set(bv);
  const eq = timingSafeEqualBytes(pa, pb);
  return eq && av.length === bv.length;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (!isHashed(stored)) {
    // Fallback za nemigirisane PIN-ove (plain text iz Airtable). Timing-safe.
    return timingSafeEqualStr(pin, stored.trim());
  }
  const rest = stored.slice(PREFIX.length);
  const parts = rest.split("$");
  if (parts.length !== 3) return false;
  const iters = Number(parts[0]);
  if (!Number.isFinite(iters) || iters <= 0) return false;
  if (iters > MAX_SUPPORTED_ITERATIONS) return false; // runtime ne podržava
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = b64decode(parts[1]);
    expected = b64decode(parts[2]);
  } catch {
    return false;
  }
  try {
    const actual = await deriveBits(pin, salt, iters, expected.length);
    return timingSafeEqualBytes(actual, expected);
  } catch {
    return false;
  }
}
