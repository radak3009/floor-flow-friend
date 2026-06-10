import { createServerFn } from "@tanstack/react-start";
import {
  RadniNalozi,
  Zastoji,
  PromeneNaloga,
  Resursi,
  Artikli,
  Komitenti,
  Grupe,
  Tipovi,
  KontaktOsobe,
  Monitoring,
} from "@/lib/airtable/sdk.server";
import type { RecordOf, TypedFilters } from "@/lib/airtable/types";
import { sharedMemoize } from "@/lib/airtable/shared-cache.server";

type RnRow = RecordOf<"RadniNalozi">;
type ZastojRow = RecordOf<"Zastoji">;
type SkartRow = RecordOf<"PromeneNaloga">;
// Inspekcija se u remixu vodi kao PromeneNaloga sa `tipZapisa = "Inspekcija"`.
type InspRow = RecordOf<"PromeneNaloga">;
type AnyRow = { id: string } & Record<string, unknown>;

const CAP = 100;

function pickStr(v: unknown): string | undefined {
  if (Array.isArray(v)) v = v[0];
  return typeof v === "string" ? v : v != null ? String(v) : undefined;
}
function pickNum(v: unknown): number | undefined {
  if (Array.isArray(v)) v = v[0];
  return typeof v === "number" ? v : undefined;
}
function firstId(v: unknown): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" && x.startsWith("rec") ? x : undefined;
}
function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}
function creatorValues(r: AnyRow): unknown[] {
  return [...asArray(r.kreiraola), ...asArray(r.kreiraoLa), ...asArray(r.kreirao)];
}

export interface RnHistoryRow {
  id: string;
  brojNaloga?: string;
  datum?: string;
  masina?: string;
  sifraArtikla?: string;
  artikalNaziv?: string;
  narucilac?: string;
  planiranaKolicina?: number;
  ispravnoProizvedeno?: number;
  skart?: number;
  realizovano?: number;
  performanse?: number;
  ukupnoTrajanjeNaloga?: string;
  statusNaloga?: string;
}

export interface ZastojHistoryRow {
  id: string;
  idZapisa?: string;
  masina?: string;
  start?: string;
  kraj?: string;
  grupa?: string;
  tip?: string;
  trajanjeZastoja?: string;
  brojNaloga?: string;
  komentar?: string;
}

export interface SkartHistoryRow {
  id: string;
  datum?: string;
  brojNaloga?: string;
  masina?: string;
  artikalNaziv?: string;
  kategorija?: string;
  kolicina?: number;
  operator?: string;
}

export interface InspHistoryRow {
  id: string;
  datum?: string;
  brojNaloga?: string;
  masina?: string;
  vizuelno?: string;
  funkcionalno?: string;
  integralniKvalitet?: string;
  ukupnaOcena?: string;
  komentar?: string;
  operator?: string;
}

export interface HistoryResult {
  kpis: {
    radniNalozi: number;
    ukupnoProiz: number;
    ukupnoSkart: number;
    zastojiTotalMin: number;
    zastojiCount: number;
  };
  radniNalozi: RnHistoryRow[];
  zastoji: ZastojHistoryRow[];
  skart: SkartHistoryRow[];
  inspekcije: InspHistoryRow[];
  truncated: { radniNalozi: boolean; zastoji: boolean; skart: boolean; inspekcije: boolean };
}

interface Input {
  from: string;
  to: string;
  resursId?: string;
  status?: string;
  lang?: "sr" | "en";
}

/** Parse "Xd Yh Zmin" / "Yh Zmin" / "Zmin" -> minutes. */
function parseTrajanjeToMin(s: string | undefined): number {
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

export const getHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((input: Input) => {
    if (!input.from || !input.to) throw new Error("from/to su obavezni");
    return input;
  })
  .handler(async ({ data }): Promise<HistoryResult> => {
    const lang: "sr" | "en" = data.lang === "en" ? "en" : "sr";
    const cacheKey = `history:v4:${data.from}|${data.to}|${data.resursId ?? ""}|${data.status ?? ""}|${lang}`;
    return sharedMemoize(cacheKey, 60_000, async () => {
    const { from, to, resursId, status } = data;

    // ----- RN: active (no close time) OR closed within period -----
    const rnBaseFilters: TypedFilters<"RadniNalozi"> = { deleted: { not: true } };
    if (status) rnBaseFilters.statusNaloga = status;

    const rnActiveFilters: TypedFilters<"RadniNalozi"> = {
      ...rnBaseFilters,
      vremeZatvaranjaNaloga: { isEmpty: true },
    };
    const rnClosedFilters: TypedFilters<"RadniNalozi"> = {
      ...rnBaseFilters,
      vremeZatvaranjaNaloga: { gte: from, lte: to },
    };

    const safe = async <T,>(p: Promise<T>, label: string): Promise<T> => {
      try {
        return await p;
      } catch (err) {
        console.error(`[history] ${label} failed:`, err);
        return { records: [] } as unknown as T;
      }
    };

    const [rnActiveRes, rnClosedRes] = await Promise.all([
      safe(RadniNalozi.findAll({ filters: rnActiveFilters, limit: CAP + 1, sort: [{ field: "vremeOtvaranjaNaloga", direction: "desc" }] }), "RadniNalozi(active)"),
      safe(RadniNalozi.findAll({ filters: rnClosedFilters, limit: CAP + 1, sort: [{ field: "vremeZatvaranjaNaloga", direction: "desc" }] }), "RadniNalozi(closed)"),
    ]);

    // Merge & dedupe
    const rnById = new Map<string, RnRow>();
    for (const r of rnActiveRes.records) rnById.set(r.id, r);
    for (const r of rnClosedRes.records) if (!rnById.has(r.id)) rnById.set(r.id, r);
    let rnRecords: RnRow[] = Array.from(rnById.values());

    // Optional client-side resource filter
    const matchResurs = (rnId: unknown) => {
      if (!resursId) return true;
      const id = firstId(rnId);
      return id === resursId;
    };
    if (resursId) rnRecords = rnRecords.filter((r) => matchResurs(r.proizvodnaLinija));

    // Sort: closed-in-period desc by close date, active records (no close) on top by open date desc
    rnRecords.sort((a, b) => {
      const ac = pickStr(a.vremeZatvaranjaNaloga);
      const bc = pickStr(b.vremeZatvaranjaNaloga);
      if (!ac && bc) return -1;
      if (ac && !bc) return 1;
      const ak = ac ?? pickStr(a.vremeOtvaranjaNaloga) ?? "";
      const bk = bc ?? pickStr(b.vremeOtvaranjaNaloga) ?? "";
      return bk.localeCompare(ak);
    });

    const rnTruncated = rnRecords.length > CAP;
    rnRecords = rnRecords.slice(0, CAP);

    const rnIdList = rnRecords.map((r) => r.id);
    // Airtable formulas treat linked-record fields as their *primary display*
    // values (here: broj naloga), not record IDs. linkAnyOf must therefore be
    // called with broj naloga strings.
    const rnBrojList = rnRecords
      .map((r) => pickStr(r.brojNaloga))
      .filter((x): x is string => !!x && x.length > 0);

    // ----- Child tables: filter by linked radniNalog ∈ rnBrojList -----

    // Orphan zastoji: no linked RN, start within period
    const zastojiOrphanFilters: TypedFilters<"Zastoji"> = {
      radniNalog: { isEmpty: true },
      start: { gte: from, lte: to },
    };

    const [zastojiLinkedRes, zastojiOrphanRes, skartRes, inspRes] = await Promise.all([
      rnBrojList.length === 0
        ? Promise.resolve({ records: [] as ZastojRow[] })
        : safe(Zastoji.findAll({ filters: { radniNalog: { linkAnyOf: rnBrojList } }, limit: CAP + 1, sort: [{ field: "start", direction: "desc" }] }), "Zastoji(linked)"),
      safe(Zastoji.findAll({ filters: zastojiOrphanFilters, limit: CAP + 1, sort: [{ field: "start", direction: "desc" }] }), "Zastoji(orphan)"),
      rnBrojList.length === 0
        ? Promise.resolve({ records: [] as SkartRow[] })
        : safe(PromeneNaloga.findAll({ filters: { radniNalog: { linkAnyOf: rnBrojList }, kolicinaSkarta: { gt: 0 }, deleted: { not: true } }, limit: CAP + 1, sort: [{ field: "datumKreiranja", direction: "desc" }] }), "Skart"),
      rnBrojList.length === 0
        ? Promise.resolve({ records: [] as InspRow[] })
        : safe(PromeneNaloga.findAll({ filters: { radniNalog: { linkAnyOf: rnBrojList }, tipZapisa: "Inspekcija", deleted: { not: true } } as any, limit: CAP + 1, sort: [{ field: "datumKreiranja", direction: "desc" }] }), "Inspekcija(PromeneNaloga)"),
    ]);

    // Defensive client-side filter in case ARRAYJOIN matching missed/over-matched.
    const rnIdSet = new Set(rnIdList);
    const matchesRn = (r: AnyRow) => {
      const id = firstId(r.radniNalog);
      return id ? rnIdSet.has(id) : false;
    };
    const linkedZastojiRecords = zastojiLinkedRes.records.filter(matchesRn);
    const skartFiltered = skartRes.records.filter(matchesRn);
    const inspFiltered = inspRes.records.filter(matchesRn);


    // Merge & dedupe zastoji (linked + orphan)
    const zastojiById = new Map<string, ZastojRow>();
    for (const r of linkedZastojiRecords) zastojiById.set(r.id, r);
    for (const r of zastojiOrphanRes.records) if (!zastojiById.has(r.id)) zastojiById.set(r.id, r);
    let zastojiRecords: ZastojRow[] = Array.from(zastojiById.values());

    // Optional resursId filter for zastoji (client-side, covers both branches).
    // Zastoji link to Monitoring via proizvodnaLinija; recordIdProizvodnaLinija holds the Resursi id.
    if (resursId) {
      zastojiRecords = zastojiRecords.filter((r) => {
        const id = firstId(r.recordIdProizvodnaLinija) ?? firstId(r.proizvodnaLinija);
        return id === resursId;
      });
    }

    zastojiRecords.sort((a, b) => (pickStr(b.start) ?? "").localeCompare(pickStr(a.start) ?? ""));

    let skartRecords = skartFiltered;
    let inspRecords = inspFiltered;

    const truncated = {
      radniNalozi: rnTruncated,
      zastoji: zastojiRecords.length > CAP,
      skart: skartRecords.length > CAP,
      inspekcije: inspRecords.length > CAP,
    };
    zastojiRecords = zastojiRecords.slice(0, CAP);
    skartRecords = skartRecords.slice(0, CAP);
    inspRecords = inspRecords.slice(0, CAP);




    // ----- Collect referenced IDs -----
    const resursiIds = new Set<string>();
    const monitoringIds = new Set<string>();
    const artikliIds = new Set<string>();
    const komitentiIds = new Set<string>();
    const grupeIds = new Set<string>();
    const tipoviIds = new Set<string>();
    const kontaktiIds = new Set<string>();
    const rnIds = new Set<string>();

    const addId = (set: Set<string>, v: unknown) => { const id = firstId(v); if (id) set.add(id); };
    const addCreatorIds = (set: Set<string>, r: AnyRow) => {
      for (const v of creatorValues(r)) addId(set, v);
    };

    for (const r of rnRecords) {
      addId(resursiIds, r.proizvodnaLinija);
      addId(artikliIds, r.artikal);
      addId(komitentiIds, r.kupac);
    }
    for (const r of zastojiRecords) {
      // Zastoji.proizvodnaLinija links to Monitoring (not Resursi directly)
      addId(monitoringIds, r.proizvodnaLinija);
      addId(resursiIds, r.recordIdProizvodnaLinija);
      addId(grupeIds, r.grupa);
      addId(tipoviIds, r.tip);
      addId(rnIds, r.radniNalog);
    }
    for (const r of skartRecords) {
      addId(resursiIds, r.proizvodnaLinija);
      addId(grupeIds, r.grupaSkarta);
      addId(tipoviIds, r.tipSkarta);
      addCreatorIds(kontaktiIds, r);
      addId(rnIds, r.radniNalog);
      addId(artikliIds, r.artikal);
    }
    for (const r of inspRecords) {
      addId(resursiIds, r.proizvodnaLinija);
      addCreatorIds(kontaktiIds, r);
      addId(rnIds, r.radniNalog);
    }

    // ----- Parallel resolver lookups -----
    const safeLookup = async <T,>(p: Promise<T>, label: string): Promise<T | null> => {
      try { return await p; } catch (e) { console.warn(`History resolver "${label}" failed:`, e); return null; }
    };

    const [resursiRes, monitoringRes, artikliRes, komitentiRes, grupeRes, tipoviRes, kontaktiRes, rnLookupRes] = await Promise.all([
      resursiIds.size ? safeLookup(Resursi.findAll({ filters: { recordId: { in: Array.from(resursiIds) } }, limit: 500 }), "Resursi") : Promise.resolve(null),
      monitoringIds.size ? safeLookup(Monitoring.findAll({ filters: { recordId: { in: Array.from(monitoringIds) } }, limit: 500 }), "Monitoring") : Promise.resolve(null),
      artikliIds.size ? safeLookup(Artikli.findAll({ filters: { recordId: { in: Array.from(artikliIds) } }, limit: 500 }), "Artikli") : Promise.resolve(null),
      komitentiIds.size ? safeLookup(Komitenti.findAll({ filters: { recordId: { in: Array.from(komitentiIds) } }, limit: 500 }), "Komitenti") : Promise.resolve(null),
      grupeIds.size ? safeLookup(Grupe.findAll({ filters: { recordId: { in: Array.from(grupeIds) } }, limit: 500 }), "Grupe") : Promise.resolve(null),
      tipoviIds.size ? safeLookup(Tipovi.findAll({ filters: { recordId: { in: Array.from(tipoviIds) } }, limit: 500 }), "Tipovi") : Promise.resolve(null),
      kontaktiIds.size ? safeLookup(KontaktOsobe.findAll({ filters: { recordId: { in: Array.from(kontaktiIds) } }, limit: 500 }), "KontaktOsobe") : Promise.resolve(null),
      rnIds.size ? safeLookup(RadniNalozi.findAll({ filters: { recordId: { in: Array.from(rnIds) } }, limit: 500 }), "RN lookup") : Promise.resolve(null),
    ]);

    const monitoringMap = new Map<string, string>();
    for (const m of monitoringRes?.records ?? []) {
      const name = pickStr(m.nazivLinije);
      if (name) monitoringMap.set(m.id, name);
    }


    const resursiMap = new Map<string, string>();
    for (const r of resursiRes?.records ?? []) {
      const naziv = pickStr(r.naziv);
      if (naziv) resursiMap.set(r.id, naziv);
    }
    const artikliMap = new Map<string, string>();
    const artikliSifraMap = new Map<string, string>();
    for (const a of artikliRes?.records ?? []) {
      const naziv = pickStr(a.naziv);
      const sifra = pickStr(a.sifraArtikla);
      if (naziv) artikliMap.set(a.id, naziv);
      if (sifra) artikliSifraMap.set(a.id, sifra);
    }
    const komitentiMap = new Map<string, string>();
    for (const k of komitentiRes?.records ?? []) {
      const naziv = pickStr(k.naziv);
      if (naziv) komitentiMap.set(k.id, naziv);
    }
    const pickLocalized = (rec: AnyRow): string | undefined => {
      const sr = pickStr(rec.naziv);
      if (lang === "en") {
        const en = pickStr((rec as Record<string, unknown>).name);
        if (en && en.trim()) return en;
      }
      return sr;
    };
    const grupeMap = new Map<string, string>();
    for (const g of grupeRes?.records ?? []) {
      const name = pickLocalized(g);
      if (name) grupeMap.set(g.id, name);
    }
    const tipoviMap = new Map<string, string>();
    for (const t of tipoviRes?.records ?? []) {
      const name = pickLocalized(t);
      if (name) tipoviMap.set(t.id, name);
    }
    const kontaktiMap = new Map<string, string>();
    for (const k of kontaktiRes?.records ?? []) {
      const name = pickStr(k.imeIPrezime);
      if (name) kontaktiMap.set(k.id, name);
    }
    const rnMap = new Map<string, string>();
    for (const r of rnLookupRes?.records ?? []) {
      const broj = pickStr(r.brojNaloga);
      if (broj) rnMap.set(r.id, broj);
    }

    const resolveName = (m: Map<string, string>, v: unknown, fallback?: unknown): string | undefined => {
      const id = firstId(v);
      if (id && m.has(id)) return m.get(id);
      return pickStr(fallback ?? v);
    };
    const resolveCreator = (m: Map<string, string>, r: AnyRow): string | undefined => {
      for (const v of creatorValues(r)) {
        const id = firstId(v);
        if (id) {
          const resolved = m.get(id);
          if (resolved) return resolved;
        } else {
          const text = pickStr(v);
          if (text) return text;
        }
      }
      return undefined;
    };

    // ----- Build rows -----
    const radniNalozi: RnHistoryRow[] = rnRecords.map((r) => ({
      id: r.id,
      brojNaloga: pickStr(r.brojNaloga),
      datum: pickStr(r.vremeOtvaranjaNaloga) ?? pickStr(r.datumKreiranja),
      masina: resolveName(resursiMap, r.proizvodnaLinija),
      sifraArtikla: pickStr(r.sifraArtikla) ?? (firstId(r.artikal) ? artikliSifraMap.get(firstId(r.artikal)!) : undefined),
      artikalNaziv: pickStr(r.artikalIzErPa) ?? resolveName(artikliMap, r.artikal),
      narucilac: resolveName(komitentiMap, r.kupac),
      planiranaKolicina: pickNum(r.planiranaKolicina),
      ispravnoProizvedeno: pickNum(r.ispravnoProizvedeno),
      skart: pickNum(r.skart),
      realizovano: pickNum(r.realizovano),
      performanse: pickNum(r.performanseFinal) ?? pickNum(r.performanse),
      ukupnoTrajanjeNaloga: pickStr(r.ukupnoTrajanjeNaloga),
      statusNaloga: pickStr(r.statusNaloga),
    }));

    const zastoji: ZastojHistoryRow[] = zastojiRecords.map((r) => ({
      id: r.id,
      idZapisa: pickStr(r.idZapisa),
      masina:
        resolveName(monitoringMap, r.proizvodnaLinija) ??
        resolveName(resursiMap, r.recordIdProizvodnaLinija) ??
        resolveName(resursiMap, r.proizvodnaLinija) ??
        (typeof pickStr(r.proizvodnaLinija) === "string" && !pickStr(r.proizvodnaLinija)!.startsWith("rec")
          ? pickStr(r.proizvodnaLinija)
          : undefined),
      start: pickStr(r.start),
      kraj: pickStr(r.kraj),
      grupa: resolveName(grupeMap, r.grupa, r.grupa1),
      tip: resolveName(tipoviMap, r.tip, r.tip1),
      trajanjeZastoja: pickStr(r.trajanjeZastojaHmin) ?? pickStr(r.trajanjeZastoja),
      brojNaloga: (() => {
        const id = firstId(r.radniNalog);
        return id ? rnMap.get(id) : pickStr(r.radniNalog);
      })(),
      komentar: pickStr(r.komentar),
    }));

    const skart: SkartHistoryRow[] = skartRecords.map((r) => {
      const rnId = firstId(r.radniNalog);
      const grupaName = resolveName(grupeMap, r.grupaSkarta);
      const tipName = resolveName(tipoviMap, r.tipSkarta);
      const kategorija = [grupaName, tipName].filter(Boolean).join(" / ") || undefined;
      return {
        id: r.id,
        datum: pickStr(r.datumKreiranja),
        brojNaloga: rnId ? rnMap.get(rnId) : pickStr(r.radniNalog),
        masina: resolveName(resursiMap, r.proizvodnaLinija),
        artikalNaziv: resolveName(artikliMap, r.artikal),
        kategorija,
        kolicina: pickNum(r.kolicinaSkarta),
        operator: resolveCreator(kontaktiMap, r),
      };
    });

    const inspekcije: InspHistoryRow[] = inspRecords.map((rec) => {
      const r = rec as AnyRow;
      const rnId = firstId(r.radniNalog);
      return {
        id: r.id,
        datum: pickStr(r.datumKreiranja),
        brojNaloga: rnId ? rnMap.get(rnId) : pickStr(r.radniNalog),
        masina: resolveName(resursiMap, r.proizvodnaLinija),
        vizuelno: pickStr(r.vizuelno),
        funkcionalno: pickStr(r.funkcionalno),
        integralniKvalitet: pickStr(r.integralniKvalitet),
        ukupnaOcena: pickStr(r.ukupnaOcena),
        komentar: pickStr(r.komentar),
        operator: resolveCreator(kontaktiMap, r),
      };
    });

    // ----- KPIs -----
    const ukupnoProiz = radniNalozi.reduce((s, r) => s + (r.ispravnoProizvedeno ?? 0), 0);
    const ukupnoSkart =
      radniNalozi.reduce((s, r) => s + (r.skart ?? 0), 0) +
      skart.reduce((s, r) => s + (r.kolicina ?? 0), 0);
    const zastojiTotalMin = zastoji.reduce((s, r) => s + parseTrajanjeToMin(r.trajanjeZastoja), 0);

    return {
      kpis: {
        radniNalozi: radniNalozi.length,
        ukupnoProiz,
        ukupnoSkart,
        zastojiTotalMin,
        zastojiCount: zastoji.length,
      },
      radniNalozi,
      zastoji,
      skart,
      inspekcije,
      truncated,
    };
    });
  });
