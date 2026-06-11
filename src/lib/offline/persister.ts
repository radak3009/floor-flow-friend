/**
 * Klijentska persistencija TanStack Query keša u IndexedDB (idb-keyval).
 * Omogućava prikaz poslednjih učitanih podataka kada nema interneta.
 * Koristi se SAMO u browseru — na serveru je no-op.
 *
 * VAŽNO (robusnost): svaka IndexedDB operacija je vremenski ograničena.
 * PersistQueryClientProvider drži `isRestoring=true` (i PAUZIRA sve
 * useQuery pozive) dok `restoreClient()` ne završi. Ako IDB "visi"
 * (poznat WebKit/iPad bug, konkurencija tabova, storage pressure),
 * restore se nikad ne završi i NIJEDAN query se ne pokrene — login radi
 * (direktan serverFn poziv), ali se podaci nikad ne učitaju. Timeout
 * garantuje da se restore uvek završi i da aplikacija nastavi sa svežim
 * fetch-ovanjem, a keš ostaje samo optimizacija.
 */
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";

export const PERSIST_CACHE_KEY = "mes-rq-cache-v1";
const KEY = PERSIST_CACHE_KEY;

/** Maksimalno čekanje na pojedinačnu IndexedDB operaciju. */
const IDB_OP_TIMEOUT_MS = 2_500;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Briše persistovani RQ keš iz IndexedDB. Bezbedno na serveru (no-op). */
export async function clearPersistedCache() {
  if (typeof window === "undefined") return;
  await withTimeout(del(KEY), IDB_OP_TIMEOUT_MS, undefined);
}

export function createIdbPersister() {
  return createAsyncStoragePersister({
    storage: {
      getItem: async (k) =>
        (await withTimeout<string | null | undefined>(get(k), IDB_OP_TIMEOUT_MS, null)) ?? null,
      setItem: async (k, v) => {
        await withTimeout(set(k, v), IDB_OP_TIMEOUT_MS, undefined);
      },
      removeItem: async (k) => {
        await withTimeout(del(k), IDB_OP_TIMEOUT_MS, undefined);
      },
    },
    key: KEY,
    throttleTime: 1000,
  });
}

// 24h — koliko dugo se keširani podaci smatraju upotrebljivim za offline prikaz
export const OFFLINE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
