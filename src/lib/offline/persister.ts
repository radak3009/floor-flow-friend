/**
 * Klijentska persistencija TanStack Query keša u IndexedDB (idb-keyval).
 * Omogućava prikaz poslednjih učitanih podataka kada nema interneta.
 * Koristi se SAMO u browseru — na serveru je no-op.
 */
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";

export const PERSIST_CACHE_KEY = "mes-rq-cache-v1";
const KEY = PERSIST_CACHE_KEY;

/** Briše persistovani RQ keš iz IndexedDB. Bezbedno na serveru (no-op). */
export async function clearPersistedCache() {
  if (typeof window === "undefined") return;
  try {
    await del(KEY);
  } catch {
    /* noop */
  }
}

export function createIdbPersister() {
  return createAsyncStoragePersister({
    storage: {
      getItem: async (k) => (await get(k)) ?? null,
      setItem: async (k, v) => {
        await set(k, v);
      },
      removeItem: async (k) => {
        await del(k);
      },
    },
    key: KEY,
    throttleTime: 1000,
  });
}

// 24h — koliko dugo se keširani podaci smatraju upotrebljivim za offline prikaz
export const OFFLINE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
