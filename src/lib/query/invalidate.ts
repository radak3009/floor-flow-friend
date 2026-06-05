/**
 * Centralizovani helperi za invalidaciju i optimistic update query keša
 * posle mutacija na Shop Floor / Monitoring / detalji naloga.
 *
 * Koristi prefix match (queryKey kao prvi element) — TanStack Query
 * podrazumevano radi delimično poklapanje, pa npr. invalidate ["history"]
 * pogađa sve varijante ["history", from, to, resursId, status].
 */
import type { QueryClient } from "@tanstack/react-query";
import type { DashboardResult, MachineDashboardRow } from "@/lib/api/dashboard.functions";
import type { PromenaRow, PromenaTip } from "@/lib/api/workorder.functions";

export interface InvalidateCtx {
  radniNalogId?: string;
  monitoringId?: string;
  resursId?: string;
}

/**
 * Invalidira sve keševe koji mogu biti pogođeni jednom akcijom
 * (start/pauza/stop/scrap/inspekcija/zastoj/brisanje škarta).
 */
export function invalidateAfterAction(qc: QueryClient, ctx: InvalidateCtx = {}) {
  qc.invalidateQueries({ queryKey: ["dashboard"] });
  qc.invalidateQueries({ queryKey: ["history"] });
  if (ctx.radniNalogId) {
    qc.invalidateQueries({ queryKey: ["wo-history", ctx.radniNalogId] });
    qc.invalidateQueries({ queryKey: ["wo-inspections", ctx.radniNalogId] });
  } else {
    // Nepoznat radniNalogId — invalidiraj sve varijante
    qc.invalidateQueries({ queryKey: ["wo-history"] });
    qc.invalidateQueries({ queryKey: ["wo-inspections"] });
  }
  if (ctx.monitoringId) {
    qc.invalidateQueries({ queryKey: ["active-downtime", ctx.monitoringId] });
  }
  if (ctx.resursId) {
    qc.invalidateQueries({ queryKey: ["available-wo", ctx.resursId] });
  }
}

/**
 * Verzija sa odlaganjem — koristi se posle akcija koje upisuju količine
 * pogođene Airtable rollup-ima (skart, dobroProizvedeno). Daje rollup-u
 * vremena da se preračuna pre nego što server vrati svežu vrednost.
 */
export function invalidateAfterActionDelayed(
  qc: QueryClient,
  ctx: InvalidateCtx = {},
  delayMs = 1800,
) {
  if (typeof window === "undefined") {
    invalidateAfterAction(qc, ctx);
    return;
  }
  window.setTimeout(() => invalidateAfterAction(qc, ctx), delayMs);
}

// ============================================================================
// Optimistic helperi za liste/agregate
// ============================================================================

export interface WoHistoryData {
  items: PromenaRow[];
}

/**
 * Optimistički ubacuje privremeni red u ["wo-history", radniNalogId].
 * Vraća snapshot za rollback (ili null ako keš ne postoji).
 */
export async function patchWoHistoryInsert(
  qc: QueryClient,
  radniNalogId: string | undefined,
  row: { tip: PromenaTip; opis: string; operator?: string },
): Promise<{ key: readonly unknown[]; prev: WoHistoryData | undefined } | null> {
  if (!radniNalogId) return null;
  const key = ["wo-history", radniNalogId] as const;
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<WoHistoryData>(key);
  if (!prev) return { key, prev: undefined };
  const optimistic: PromenaRow = {
    id: `__optimistic:${tempId()}`,
    createdAt: new Date().toISOString(),
    ...row,
  };
  // Najnovije prvo — server sortira opadajuće po createdAt; dodajemo na vrh.
  qc.setQueryData<WoHistoryData>(key, { ...prev, items: [optimistic, ...prev.items] });
  return { key, prev };
}

/**
 * Optimistički uklanja red iz ["wo-history", radniNalogId] po id-u.
 */
export async function patchWoHistoryRemove(
  qc: QueryClient,
  radniNalogId: string | undefined,
  rowId: string,
): Promise<{ key: readonly unknown[]; prev: WoHistoryData | undefined } | null> {
  if (!radniNalogId) return null;
  const key = ["wo-history", radniNalogId] as const;
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<WoHistoryData>(key);
  if (!prev) return { key, prev: undefined };
  qc.setQueryData<WoHistoryData>(key, {
    ...prev,
    items: prev.items.filter((it) => it.id !== rowId),
  });
  return { key, prev };
}

/**
 * Optimistički patch jednog reda u ["dashboard"] (po monitoringId).
 */
export async function patchDashboardRow(
  qc: QueryClient,
  monitoringId: string | undefined,
  patch: (row: MachineDashboardRow) => MachineDashboardRow,
): Promise<{ key: readonly unknown[]; prev: DashboardResult | undefined } | null> {
  if (!monitoringId) return null;
  const key = ["dashboard"] as const;
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<DashboardResult>(key);
  if (!prev) return { key, prev: undefined };
  qc.setQueryData<DashboardResult>(key, {
    ...prev,
    machines: prev.machines.map((row) =>
      row.monitoringId === monitoringId ? patch(row) : row,
    ),
  });
  return { key, prev };
}

/** Vrati snapshot u keš (rollback) — bezbedno za undefined/null. */
export function rollback(
  qc: QueryClient,
  snap: { key: readonly unknown[]; prev: unknown } | null | undefined,
) {
  if (!snap) return;
  if (snap.prev !== undefined) qc.setQueryData(snap.key as unknown[], snap.prev);
}

function tempId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
