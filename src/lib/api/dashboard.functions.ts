import { createServerFn } from "@tanstack/react-start";
import { Monitoring, RadniNalozi, Artikli, Resursi } from "@/lib/airtable/sdk.server";
import type { RecordOf } from "@/lib/airtable/types";
import { sharedMemoize } from "@/lib/airtable/shared-cache.server";
import { getActiveOverrides, reconcileAndDrop, deleteOverride, type OverridePatch, type OverrideExpected } from "@/lib/api/overrides.server";

export interface MachineDashboardRow {
  monitoringId: string;
  nazivLinije: string;
  statusMasine: string;
  avatarUrl?: string;
  radniNalogId?: string;
  brojNaloga?: string;
  sifraArtikla?: string;
  artikalNaziv?: string;
  narucilac?: string;
  alat?: string;
  planiranaKolicina?: number;
  ispravnoProizvedeno?: number;
  skart?: number;
  statusNaloga?: string;
  resursiId?: string;
  procenatRealizacije?: number;
  procenatSkarta?: number;
  dobroProizvedeno?: number;
  preostaloZaProizvodnju?: number;
  ciklusiTotal?: number;
  projektovanCiklusSek?: number;
  trenutniCiklusSek?: number;
  performanse?: number;
  brojKaviteta?: number;
  masaKomadaG?: number;
  planiranStart?: string;
  planiranKraj?: string;
  grupaZastoja?: string;
  tipZastojaDetail?: string;
  trajanjeZastoja?: string;
  startZastoja?: string;
  startNaloga?: string;
  vremeOtvaranjaNaloga?: string;
  procenjenoTrajanje?: string;
  hasAvailableOrders: boolean;
}

export interface DashboardResult {
  machines: MachineDashboardRow[];
  kpis: { uRadu: number; zastoj: number; nemaSig: number; off: number; total: number };
}

function pickNum(v: unknown): number | undefined {
  if (Array.isArray(v)) v = v[0];
  return typeof v === "number" ? v : undefined;
}
function pickStr(v: unknown): string | undefined {
  if (Array.isArray(v)) v = v[0];
  return typeof v === "string" ? v : v != null ? String(v) : undefined;
}
function firstId(v: unknown): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x : undefined;
}
function avatarUrlOf(v: unknown): string | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const first = v[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object") return undefined;
  const thumbs = first.thumbnails as { large?: { url?: string } } | undefined;
  if (thumbs?.large?.url) return thumbs.large.url;
  return typeof first.url === "string" ? first.url : undefined;
}

function statusFilterKey(status: string | undefined): "uRadu" | "zastoj" | "nemaSig" | "off" | "other" {
  const s = (status || "").split(" |")[0];
  if (s === "U radu") return "uRadu";
  if (s === "Zastoj") return "zastoj";
  if (s === "Nema signala") return "nemaSig";
  if (s === "OFF") return "off";
  return "other";
}

async function buildAirtableDashboard(): Promise<{ machines: MachineDashboardRow[] }> {
  const [monResult, rnResult] = await Promise.all([
    Monitoring.findAll({ limit: 200 }),
    RadniNalozi.findAll({
      filters: { statusNaloga: { notIn: ["Završen", "Arhiviran"] }, deleted: { not: true } },
      limit: 500,
    }),
  ]);

  type Rn = RecordOf<"RadniNalozi">;
  const woMap = new Map<string, Rn>(rnResult.records.map((rn) => [rn.id, rn]));

  const availableResursiIds = new Set<string>(
    rnResult.records
      .filter((rn) => rn.statusNaloga === "Potvrđen" || rn.statusNaloga === "Pauziran")
      .map((rn) => firstId(rn.proizvodnaLinija))
      .filter((id): id is string => !!id),
  );

  const neededArtIds = new Set<string>();
  for (const m of monResult.records) {
    const rnId = firstId(m.radniNalog);
    const wo = rnId ? woMap.get(rnId) : undefined;
    if (!wo || wo.artikalIzErPa) continue;
    const aid = firstId(wo.artikal);
    if (aid) neededArtIds.add(aid);
  }

  const artikliMap = new Map<string, string>();
  if (neededArtIds.size > 0) {
    const artResult = await Artikli.findAll({ filters: { recordId: { in: Array.from(neededArtIds) } }, limit: 500 });
    for (const art of artResult.records) {
      if (typeof art.naziv === "string") artikliMap.set(art.id, art.naziv);
    }
  }

  // Resolve alat record ids -> naziv
  const neededAlatIds = new Set<string>();
  for (const m of monResult.records) {
    const rnId = firstId(m.radniNalog);
    const wo = rnId ? woMap.get(rnId) : undefined;
    const aid = firstId(wo?.alat);
    if (aid && aid.startsWith("rec")) neededAlatIds.add(aid);
  }
  const alatMap = new Map<string, string>();
  if (neededAlatIds.size > 0) {
    try {
      const alatResult = await Resursi.findAll({ filters: { recordId: { in: Array.from(neededAlatIds) } }, limit: 500 });
      for (const a of alatResult.records) {
        if (typeof a.naziv === "string") alatMap.set(a.id, a.naziv);
      }
    } catch (e) {
      console.warn("Failed to resolve alat names:", e);
    }
  }

  const machines: MachineDashboardRow[] = monResult.records.map((m) => {
    let radniNalogId = firstId(m.radniNalog);
    let wo = radniNalogId ? woMap.get(radniNalogId) : undefined;
    const resursiId = firstId(m.proizvodnaLinija);



    if (wo && resursiId) {
      const woLinijaId = firstId(wo.proizvodnaLinija);
      if (woLinijaId && woLinijaId !== resursiId) {
        console.warn(
          `[dashboard] Mismatch proizvodnaLinija for Monitoring ${m.id} (${pickStr(m.nazivLinije)}): ` +
          `WO ${wo.id} (${pickStr(wo.brojNaloga)}) has linija ${woLinijaId}, expected ${resursiId}. Hiding WO from card.`,
        );
        wo = undefined;
        radniNalogId = undefined;
      }
    }

    let artikalNaziv: string | undefined;
    if (typeof wo?.artikalIzErPa === "string") artikalNaziv = wo.artikalIzErPa;
    else if (wo) {
      const artId = firstId(wo.artikal);
      if (artId) artikalNaziv = artikliMap.get(artId);
    }

    return {
      monitoringId: m.id,
      nazivLinije: pickStr(m.nazivLinije) || "Nepoznata mašina",
      statusMasine: pickStr(m.statusMasine) || "Nema signala",
      avatarUrl: avatarUrlOf(m.avatar),
      radniNalogId,
      brojNaloga: pickStr(wo?.brojNaloga),
      sifraArtikla: pickStr(wo?.sifraArtikla),
      artikalNaziv,
      narucilac: pickStr(wo?.kupac),
      alat: (() => {
        const aid = firstId(wo?.alat);
        if (aid && aid.startsWith("rec")) return alatMap.get(aid) || pickStr(wo?.alatLookup);
        return pickStr(wo?.alat) || pickStr(wo?.alatLookup);
      })(),
      planiranaKolicina: pickNum(wo?.planiranaKolicina),
      ispravnoProizvedeno: pickNum(wo?.ispravnoProizvedeno),
      skart: pickNum(wo?.skart),
      statusNaloga: pickStr(m.statusNaloga),
      resursiId,
      procenatRealizacije: pickNum(m.procenatRealizacije),
      procenatSkarta: pickNum(m.procenatSkarta),
      dobroProizvedeno: pickNum(m.dobroProizvedeno),
      preostaloZaProizvodnju: pickNum(m.preostaloZaProizvodnju),
      ciklusiTotal: pickNum(m.ciklusiTotal),
      projektovanCiklusSek: pickNum(m.projektovanCiklusSek),
      trenutniCiklusSek: pickNum(m.trenutniCiklusSek),
      performanse: (() => {
        const proj = pickNum(m.projektovanCiklusSek);
        const tren = pickNum(m.trenutniCiklusSek);
        if (proj && tren) return (tren - proj) / proj;
        // Fallback: parse string formule "🟩 8.9%" iz RadniNalozi/Monitoring
        const raw = (wo as any)?.performanse ?? m.performanseFinal ?? m.performanse;
        const s = Array.isArray(raw) ? raw[0] : raw;
        if (typeof s === "number") return s;
        if (typeof s === "string") {
          const match = s.match(/-?\d+(?:[.,]\d+)?/);
          if (match) return parseFloat(match[0].replace(",", ".")) / 100;
        }
        return undefined;
      })(),

      brojKaviteta: pickNum(m.brojKaviteta) ?? pickNum(wo?.brojKaviteta),
      masaKomadaG: pickNum((wo as any)?.masaKomadaG),
      planiranStart: pickStr(wo?.planiranStart),
      planiranKraj: pickStr(wo?.planiranKraj),
      grupaZastoja: pickStr(m.grupa),
      tipZastojaDetail: pickStr(m.tip),
      trajanjeZastoja:
        (Array.isArray(m.trajanjeZastoja) && m.trajanjeZastoja[0] != null
          ? String(m.trajanjeZastoja[0])
          : typeof m.trajanjeZastoja === "string"
            ? m.trajanjeZastoja
            : undefined) ?? pickStr(m.trajanjeZastojaHmin),
      startZastoja: pickStr(m.start),
      startNaloga: pickStr(m.start),
      vremeOtvaranjaNaloga: pickStr(wo?.vremeOtvaranjaNaloga),
      procenjenoTrajanje: pickStr(m.procenjenoTrajanjeDhmin),
      hasAvailableOrders: resursiId ? availableResursiIds.has(resursiId) : false,
    };
  });

  return { machines };
}

/**
 * Vrati listu "expected" ključeva koje je Airtable-row već sustigao.
 * Ne mutira ulaz.
 */
function matchedKeys(row: MachineDashboardRow, expected: OverrideExpected): string[] {
  const matched: string[] = [];
  for (const [k, v] of Object.entries(expected)) {
    if (k === "skartGte") {
      const cur = typeof row.skart === "number" ? row.skart : 0;
      if (typeof v === "number" && cur >= v) matched.push(k);
      continue;
    }
    if (k === "notZastoj") {
      if (v === true && statusFilterKey(row.statusMasine) !== "zastoj") matched.push(k);
      continue;
    }
    if (k === "poceoNeq") {
      // matched kada je Airtable promenio vremeOtvaranjaNaloga u odnosu na staru vrednost
      const cur = row.vremeOtvaranjaNaloga ?? null;
      if (cur != null && cur !== v) matched.push(k);
      continue;
    }
    const cur = (row as unknown as Record<string, unknown>)[k];
    if (v === null) {
      if (cur == null || cur === "" || cur === false) matched.push(k);
    } else if (cur === v) {
      matched.push(k);
    }
  }
  return matched;
}

function applyPatch(row: MachineDashboardRow, patch: OverridePatch, dropKeys: Set<string>): MachineDashboardRow {
  const next: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(patch)) {
    if (dropKeys.has(k)) continue;
    if (v === null) {
      next[k] = undefined;
    } else {
      next[k] = v;
    }
  }
  return next as unknown as MachineDashboardRow;
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export const getDashboardFn = createServerFn({ method: "GET" }).handler(async (): Promise<DashboardResult> => {
  // 1) Cached Airtable build (deljeno za celu flotu)
  const cached = await sharedMemoize("dashboard:airtable:v1", 60_000, buildAirtableDashboard);

  // 2) Live overrides iz Supabase — time-boxed da spor/nedostupan Supabase
  //    nikad ne blokira dashboard. Ako istekne, vrati prazan skup; override-i
  //    se pojave na sledećem refetch-u.
  const overrides = await withTimeout(getActiveOverrides(), 800, new Map());

  // 3) Merge per-mašina; reconcile delimično/potpuno sustignute
  const machines: MachineDashboardRow[] = cached.machines.map((row) => {
    const ov = overrides.get(row.monitoringId);
    if (!ov) return row;

    const expectedKeys = Object.keys(ov.expected);
    const matched = matchedKeys(row, ov.expected);

    // Mapiraj matched expected ključeve -> patch polja koje treba izostaviti
    const dropFromPatch = new Set<string>();
    for (const k of matched) {
      if (k === "skartGte") dropFromPatch.add("skart");
      else if (k === "notZastoj") dropFromPatch.add("statusMasine");
      else if (k === "poceoNeq") dropFromPatch.add("vremeOtvaranjaNaloga");
      else dropFromPatch.add(k);
    }

    // Ako su SVI expected sustignuti — obriši CEO override red i ne primenjuj patch.
    if (expectedKeys.length > 0 && matched.length === expectedKeys.length) {
      void deleteOverride(row.monitoringId);
      return row;
    }

    // Fire-and-forget reconcile delimično sustignutih ključeva — samo ako bi
    // poziv stvarno smanjio patch (matched ključ još uvek mapira na polje
    // prisutno u patch-u). Sprečava ponavljane Supabase upise na svakom read-u.
    if (matched.length > 0) {
      const patchKeys = new Set(Object.keys(ov.patch));
      const wouldShrink = matched.some((k) =>
        k === "skartGte"
          ? patchKeys.has("skart")
          : k === "notZastoj"
            ? patchKeys.has("statusMasine")
            : k === "poceoNeq"
              ? patchKeys.has("vremeOtvaranjaNaloga")
              : patchKeys.has(k),
      );
      if (wouldShrink) void reconcileAndDrop(row.monitoringId, matched);
    }

    return applyPatch(row, ov.patch, dropFromPatch);
  });

  // 4) KPI POSLE merge-a
  const kpis = {
    uRadu: machines.filter((m) => m.statusMasine?.startsWith("U radu")).length,
    zastoj: machines.filter((m) => m.statusMasine === "Zastoj").length,
    nemaSig: machines.filter((m) => m.statusMasine === "Nema signala").length,
    off: machines.filter((m) => m.statusMasine === "OFF").length,
    total: machines.length,
  };

  return { machines, kpis };
});

