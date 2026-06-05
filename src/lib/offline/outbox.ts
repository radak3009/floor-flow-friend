/**
 * Offline Outbox — IndexedDB red čekanja za mutacije.
 *
 * Korisnik klikne → outbox.enqueue(type, payload)
 *   - Generiše se clientOpId (UUID), upisuje u IDB
 *   - Ako je online: pokušaj odmah da pošalješ (flush)
 *   - Ako je offline: čeka; flush startuje na `online` event-u ili 15s intervalu
 *   - Server dedupe po clientOpId sprečava duple upise pri retry-u
 *
 * Runners se registruju jednom (init), mapiraju type → server fn poziv.
 */
import { get, set } from "idb-keyval";

const STORE_KEY = "mes-outbox-v1";
const FLUSH_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 5;

export type OutboxStatus = "pending" | "running" | "failed";

export interface OutboxOp {
  id: string;            // clientOpId (UUID) — isti se šalje serveru za dedupe
  type: string;          // npr. "startWorkOrder", "logScrap"
  label: string;         // ljudski opis za UI: "Start naloga RN-123"
  payload: any;          // payload za server fn (BEZ clientOpId)
  createdAt: number;
  attempts: number;
  lastError?: string;
  status: OutboxStatus;
}

type Runner = (payload: any, clientOpId: string) => Promise<unknown>;
type OnSuccess = (op: OutboxOp, result: unknown) => void;

const runners = new Map<string, Runner>();
const subscribers = new Set<() => void>();
let onSuccessCb: OnSuccess | null = null;

let queue: OutboxOp[] = [];
let loaded = false;
let flushing = false;
let initialized = false;

function uuid(): string {
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) return (crypto as any).randomUUID();
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const stored = (await get<OutboxOp[]>(STORE_KEY)) ?? [];
    queue = stored.map((o) => ({ ...o, status: o.status === "running" ? "pending" : o.status }));
  } catch (e) {
    console.warn("[outbox] load failed", e);
    queue = [];
  }
  emit();
}

async function persist() {
  try {
    await set(STORE_KEY, queue);
  } catch (e) {
    console.warn("[outbox] persist failed", e);
  }
}

let snapshot: OutboxOp[] = [];

function recomputeSnapshot() {
  snapshot = [...queue].sort((a, b) => a.createdAt - b.createdAt);
}

function emit() {
  recomputeSnapshot();
  for (const cb of subscribers) {
    try { cb(); } catch { /* noop */ }
  }
}

export function subscribeOutbox(cb: () => void): () => void {
  subscribers.add(cb);
  // Inicijalni snapshot
  void ensureLoaded();
  return () => { subscribers.delete(cb); };
}

export function getOutboxOps(): OutboxOp[] {
  return snapshot;
}

export function getPendingCount(): number {
  return queue.filter((o) => o.status !== "running").length;
}

export function registerRunner(type: string, fn: Runner) {
  runners.set(type, fn);
}

export function setOnSuccess(cb: OnSuccess) {
  onSuccessCb = cb;
}

/**
 * Doda operaciju u outbox.
 * - Ako je online i runner uspe odmah → vraća rezultat, ne upisuje u IDB.
 * - Ako padne ili je offline → upisuje u IDB i vraća { queued: true }.
 */
export async function enqueue<T = unknown>(
  type: string,
  label: string,
  payload: any,
): Promise<{ queued: boolean; result?: T; op: OutboxOp }> {
  await ensureLoaded();
  const op: OutboxOp = {
    id: uuid(),
    type,
    label,
    payload,
    createdAt: Date.now(),
    attempts: 0,
    status: "pending",
  };
  queue.push(op);
  await persist();
  emit();

  // Pokušaj odmah ako smo online
  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const result = await runOne(op);
      return { queued: false, result: result as T, op };
    } catch (e) {
      // Ostavi u redu; vratiće se kasnije
      return { queued: true, op };
    }
  }
  return { queued: true, op };
}

async function runOne(op: OutboxOp): Promise<unknown> {
  const runner = runners.get(op.type);
  if (!runner) {
    op.lastError = `Nepoznat tip operacije: ${op.type}`;
    op.status = "failed";
    await persist();
    emit();
    throw new Error(op.lastError);
  }
  op.status = "running";
  op.attempts += 1;
  emit();
  try {
    const result = await runner(op.payload, op.id);
    // Uspeh — ukloni iz reda
    queue = queue.filter((q) => q.id !== op.id);
    await persist();
    emit();
    try { onSuccessCb?.(op, result); } catch { /* noop */ }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // KONFLIKT je terminalno stanje — server je odbio jer je status u međuvremenu već promenjen.
    // Uklanjamo stavku iz outboxa (ne pokušava se ponovo), beleži se i prosleđuje gore.
    if (msg.startsWith("KONFLIKT:")) {
      queue = queue.filter((q) => q.id !== op.id);
      op.lastError = msg;
      op.status = "failed";
      await persist();
      emit();
      throw e;
    }
    op.lastError = msg;
    op.status = op.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
    await persist();
    emit();
    throw e;
  }
}

export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  await ensureLoaded();
  flushing = true;
  try {
    // Sequential — da se ne pokvari logika tipa Start pa odmah Pauza
    while (true) {
      const next = queue.find((o) => o.status === "pending");
      if (!next) break;
      try {
        await runOne(next);
      } catch {
        // Ako jedna padne, prekidamo iteraciju da ne hammer-ujemo server.
        // Ostaje u redu, pokušaće se opet pri sledećem flush-u.
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

/** Ručni retry — resetuje attempts za određenu stavku i flush-uje. */
export async function retryOp(opId: string): Promise<void> {
  await ensureLoaded();
  const op = queue.find((q) => q.id === opId);
  if (!op) return;
  op.status = "pending";
  op.attempts = 0;
  op.lastError = undefined;
  await persist();
  emit();
  void flushOutbox();
}

/** Ukloni operaciju iz reda (npr. kada korisnik želi da odustane). */
export async function removeOp(opId: string): Promise<void> {
  await ensureLoaded();
  queue = queue.filter((q) => q.id !== opId);
  await persist();
  emit();
}

/** Idempotentna inicijalizacija — pozovi jednom (npr. u _auth layout-u). */
export function initOutbox() {
  if (initialized) return;
  initialized = true;
  if (typeof window === "undefined") return;
  void ensureLoaded().then(() => { void flushOutbox(); });
  window.addEventListener("online", () => { void flushOutbox(); });
  setInterval(() => { void flushOutbox(); }, FLUSH_INTERVAL_MS);
}
