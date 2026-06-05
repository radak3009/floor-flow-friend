// Pure history aggregation helpers. No I/O.

export interface ZastojRowLike {
  id: string;
  start?: string;
  trajanjeZastoja?: string;
  brojNaloga?: string;
}

export interface RnRowLike {
  ispravnoProizvedeno?: number;
  skart?: number;
}

export interface SkartRowLike {
  kolicina?: number;
}

/** Parse "Xd Yh Zmin" / "Yh Zmin" / "Zmin" -> total minutes. */
export function parseTrajanjeToMin(s: string | undefined): number {
  if (!s) return 0;
  let total = 0;
  const d = /(\d+)\s*d/.exec(s);
  const h = /(\d+)\s*h/.exec(s);
  const m = /(\d+)\s*min/.exec(s);
  if (d) total += parseInt(d[1], 10) * 24 * 60;
  if (h) total += parseInt(h[1], 10) * 60;
  if (m) total += parseInt(m[1], 10);
  return total;
}

export interface KpiInput {
  radniNalozi: RnRowLike[];
  zastoji: ZastojRowLike[];
  skart: SkartRowLike[];
}

export interface Kpis {
  radniNalozi: number;
  ukupnoProiz: number;
  ukupnoSkart: number;
  zastojiTotalMin: number;
  zastojiCount: number;
}

export function computeKpis({ radniNalozi, zastoji, skart }: KpiInput): Kpis {
  const ukupnoProiz = radniNalozi.reduce((s, r) => s + (r.ispravnoProizvedeno ?? 0), 0);
  const ukupnoSkart =
    radniNalozi.reduce((s, r) => s + (r.skart ?? 0), 0) +
    skart.reduce((s, r) => s + (r.kolicina ?? 0), 0);
  // Includes zastoji without a linked RN.
  const zastojiTotalMin = zastoji.reduce((s, r) => s + parseTrajanjeToMin(r.trajanjeZastoja), 0);
  return {
    radniNalozi: radniNalozi.length,
    ukupnoProiz,
    ukupnoSkart,
    zastojiTotalMin,
    zastojiCount: zastoji.length,
  };
}

/** Merge linked + orphan zastoji; dedupe by id; sort by `start` desc. */
export function mergeZastoji<T extends { id: string; start?: string }>(
  linked: T[],
  orphan: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const r of linked) byId.set(r.id, r);
  for (const r of orphan) if (!byId.has(r.id)) byId.set(r.id, r);
  const out = Array.from(byId.values());
  out.sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
  return out;
}
