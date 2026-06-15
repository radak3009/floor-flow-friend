import { createServerFn } from "@tanstack/react-start";
import { RadniNalozi, PromeneNaloga, KontaktOsobe, Grupe, Tipovi, Artikli, Role, Komitenti } from "@/lib/airtable/sdk.server";
import { findIdByClientOpId } from "@/lib/airtable/dedupe.server";
import { memoize } from "@/lib/airtable/cache.server";
import { sharedMemoize, sharedInvalidate } from "@/lib/airtable/shared-cache.server";
import { upsertOverride } from "@/lib/api/overrides.server";
import { requirePinSession } from "@/lib/auth/pin-session.server";
import { acquireTransition, releaseTransition, conflictError } from "@/lib/api/wo-lock.server";
import {
  performActionCore,
  validate,
  type ActionInput,
  type PerformActionDeps,
} from "@/lib/api/workorder.logic";

const prodDeps: PerformActionDeps = {
  findDedupe: (clientOpId) => findIdByClientOpId("PromeneNaloga", clientOpId),
  fetchWorkOrder: async (id) => {
    const r = await RadniNalozi.findOne({ id });
    if (!r) return null;
    return { statusNaloga: typeof r.statusNaloga === "string" ? r.statusNaloga : undefined };
  },
  acquire: async (args) => {
    const r = await acquireTransition(args);
    return r.ok
      ? { ok: true, currentStatus: args.airtableStatus }
      : { ok: false, currentStatus: r.currentStatus };
  },
  release: (args) => releaseTransition(args),
  updateStatus: async (id, status) => {
    await RadniNalozi.update({ id, record: { statusNaloga: status } });
  },
  createPromena: async (record) => {
    await PromeneNaloga.create({ record });
  },
  now: () => new Date().toISOString(),
};

async function performAction(input: ActionInput) {
  return performActionCore(input, prodDeps);
}

// Klijent prosleđuje monitoringId + (za start) woMeta da bismo upisali override
// bez dodatnih Airtable poziva.
interface WoMeta {
  brojNaloga?: string;
  sifraArtikla?: string;
  artikalNaziv?: string;
  planiranaKolicina?: number;
}

type StartActionInput = Omit<ActionInput, "action" | "userId"> & {
  userId?: string;
  monitoringId?: string;
  woMeta?: WoMeta;
};

// Stop override: nuliraj sva polja vezana za nalog/proizvodnju.
// NE diraj: statusMasine, nazivLinije, avatarUrl, resursiId, monitoringId, hasAvailableOrders.
const STOP_PATCH = {
  statusNaloga: null,
  brojNaloga: null,
  radniNalogId: null,
  sifraArtikla: null,
  artikalNaziv: null,
  narucilac: null,
  alat: null,
  planiranaKolicina: null,
  ispravnoProizvedeno: null,
  dobroProizvedeno: null,
  skart: null,
  procenatRealizacije: null,
  procenatSkarta: null,
  preostaloZaProizvodnju: null,
  ciklusiTotal: null,
  projektovanCiklusSek: null,
  trenutniCiklusSek: null,
  performanse: null,
  brojKaviteta: null,
  masaKomadaG: null,
  planiranStart: null,
  planiranKraj: null,
  vremeOtvaranjaNaloga: null,
  procenjenoTrajanje: null,
} as const;
// Kad Airtable raskine vezu naloga, brojNaloga postane prazan — pouzdan signal.
const STOP_EXPECTED = { brojNaloga: null } as const;

async function performActionAndOverride(
  input: ActionInput & { monitoringId?: string; woMeta?: WoMeta },
) {
  const result = await performAction(input);
  if ((result as { deduped?: boolean })?.deduped) return result;

  // Override — TRENUTNA vidljivost; bez dodatnih Airtable poziva.
  if (input.monitoringId) {
    const monId = input.monitoringId;
    if (input.action === "start") {
      const meta = input.woMeta || {};
      await upsertOverride(
        monId,
        {
          radniNalogId: input.radniNalogId,
          brojNaloga: meta.brojNaloga,
          sifraArtikla: meta.sifraArtikla,
          artikalNaziv: meta.artikalNaziv,
          planiranaKolicina: meta.planiranaKolicina,
          statusNaloga: "U radu",
          statusMasine: "U radu",
          // Nuliranje proizvodnih statistika za nov nalog (sprečava nasleđivanje
          // sa prethodnog naloga dok Airtable ne sustigne).
          skart: 0,
          dobroProizvedeno: 0,
          ispravnoProizvedeno: 0,
          ciklusiTotal: 0,
          procenatRealizacije: 0,
          procenatSkarta: 0,
          preostaloZaProizvodnju: meta.planiranaKolicina ?? null,
          performanse: null,
          projektovanCiklusSek: null,
          trenutniCiklusSek: null,
          procenjenoTrajanje: null,
        },
        { radniNalogId: input.radniNalogId },
        120_000,
        /* replace */ true,
      );
    } else if (input.action === "pause") {
      await upsertOverride(monId, { statusNaloga: "Pauziran" }, { statusNaloga: "Pauziran" });
    } else if (input.action === "resume") {
      await upsertOverride(monId, { statusNaloga: "U radu", statusMasine: "U radu" }, { statusNaloga: "U radu" });
    } else if (input.action === "stop") {
      await upsertOverride(monId, STOP_PATCH, STOP_EXPECTED);
    }
  }

  // available-wo se i dalje invalidira (lista naloga je zasebna od dashboard-a).
  await sharedInvalidate("available-wo");
  return result;
}

export const startWorkOrderFn = createServerFn({ method: "POST" })
  .middleware([requirePinSession])
  .inputValidator((input: StartActionInput) => {
    const base = validate({ ...input, action: "start", userId: "" });
    return { ...base, monitoringId: input.monitoringId, woMeta: input.woMeta };
  })
  .handler(async ({ data, context }) =>
    performActionAndOverride({ ...data, userId: context.pin.userId }),
  );

export const pauseWorkOrderFn = createServerFn({ method: "POST" })
  .middleware([requirePinSession])
  .inputValidator((input: StartActionInput) => {
    const base = validate({ ...input, action: "pause", userId: "" });
    return { ...base, monitoringId: input.monitoringId };
  })
  .handler(async ({ data, context }) =>
    performActionAndOverride({ ...data, userId: context.pin.userId }),
  );

export const resumeWorkOrderFn = createServerFn({ method: "POST" })
  .middleware([requirePinSession])
  .inputValidator((input: StartActionInput) => {
    const base = validate({ ...input, action: "resume", userId: "" });
    return { ...base, monitoringId: input.monitoringId };
  })
  .handler(async ({ data, context }) =>
    performActionAndOverride({ ...data, userId: context.pin.userId }),
  );

export const stopWorkOrderFn = createServerFn({ method: "POST" })
  .middleware([requirePinSession])
  .inputValidator((input: StartActionInput) => {
    const base = validate({ ...input, action: "stop", userId: "" });
    return { ...base, monitoringId: input.monitoringId };
  })
  .handler(async ({ data, context }) =>
    performActionAndOverride({ ...data, userId: context.pin.userId }),
  );

// ---------- History ----------
export type PromenaTip = "start" | "pauza" | "nastavak" | "stop" | "skart" | "definisanje" | "podela" | "promena";

export interface PromenaRow {
  id: string;
  createdAt?: string;
  tip: PromenaTip;
  opis: string;
  operator?: string;
}

type AnyRow = Record<string, unknown>;

function isZastojRow(r: AnyRow): boolean {
  const z = r.zastoj;
  if (z == null) return false;
  if (Array.isArray(z)) return z.length > 0;
  if (typeof z === "string") return z.trim().length > 0;
  return Boolean(z);
}

function arrayify(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}

function creatorValues(r: AnyRow): unknown[] {
  return [
    ...arrayify(r.kreiraola),
    ...arrayify(r.kreiraoLa),
    ...arrayify(r.kreirao),
  ];
}

function resolveCreatorName(nameById: Map<string, string>, r: AnyRow): string | undefined {
  for (const raw of creatorValues(r)) {
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (!v) continue;
    if (v.startsWith("rec")) {
      const resolved = nameById.get(v);
      if (resolved) return resolved;
      continue;
    }
    return v;
  }
  return undefined;
}

export const getWorkOrderHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((input: { radniNalogId: string; limit?: number }) => {
    if (!input.radniNalogId) throw new Error("radniNalogId je obavezan");
    return { radniNalogId: input.radniNalogId, limit: input.limit ?? 50 };
  })
  .handler(async ({ data }): Promise<{ items: PromenaRow[] }> => {
    const { records } = await PromeneNaloga.findAll({
      filters: { deleted: { not: true } },
      sort: [{ field: "datumKreiranja", direction: "desc" }],
      limit: 300,
    });

    const filtered = records.filter((r) => {
      const link = r.radniNalog;
      const matches = Array.isArray(link) ? link.includes(data.radniNalogId) : link === data.radniNalogId;
      if (!matches) return false;
      return !isZastojRow(r);
    });

    const sliced = filtered.slice(0, data.limit);

    // Resolve operator record IDs (kreiraola / kreiraoLa / kreirao link to KontaktOsobe) to imeIPrezime
    const idSet = new Set<string>();
    for (const r of sliced) {
      for (const v of creatorValues(r)) {
        if (typeof v === "string" && v.startsWith("rec")) idSet.add(v);
      }
    }
    const nameById = new Map<string, string>();
    if (idSet.size > 0) {
      try {
        const { records: people } = await KontaktOsobe.findAll({
          filters: { recordId: { in: Array.from(idSet) } },
          limit: 200,
        });
        for (const p of people) {
          if (typeof p.imeIPrezime === "string") nameById.set(p.id, p.imeIPrezime);
        }
      } catch (e) {
        console.warn("Failed to resolve operator names:", e);
      }
    }

    const items: PromenaRow[] = sliced.map((r) => {
      let tip: PromenaTip = "promena";
      let opis = "Promena";
      const skart = typeof r.kolicinaSkarta === "number" ? r.kolicinaSkarta : undefined;

      if (r.pokretanje) { tip = "start"; opis = "Pokretanje"; }
      else if (r.pauziranje) { tip = "pauza"; opis = "Pauziranje"; }
      else if (r.reaktivacija) { tip = "nastavak"; opis = "Nastavak"; }
      else if (r.zatvaranje) { tip = "stop"; opis = "Zatvaranje naloga"; }
      else if (skart && skart > 0) { tip = "skart"; opis = `Ubeležen škart ${skart} kom`; }
      else if (typeof r.komentar === "string" && r.komentar.trim()) { opis = r.komentar.trim(); }

      const operator = resolveCreatorName(nameById, r);

      return {
        id: r.id,
        createdAt: r.datumKreiranja as string | undefined,
        tip,
        opis,
        operator,
      };
    });

    return { items };
  });

// ============= Available Work Orders (for Start picker) =============
export interface AvailableWorkOrder {
  id: string;
  brojNaloga?: string;
  statusNaloga?: string;
  sifraArtikla?: string;
  artikalNaziv?: string;
  planiranaKolicina?: number;
  bukingSort?: number | string;
  planiranStart?: string;
  narucilac?: string;
}


const STARTABLE_STATUSES = ["Potvrđen", "Spreman", "Pauziran"];

export const getAvailableWorkOrdersFn = createServerFn({ method: "GET" })
  .inputValidator((input: { resursId: string }) => {
    if (!input.resursId) throw new Error("resursId je obavezan");
    return { resursId: input.resursId };
  })
  .handler(async ({ data }): Promise<{ items: AvailableWorkOrder[] }> => {
    return sharedMemoize(`available-wo:v1:${data.resursId}`, 30_000, async () => {
    const { records } = await RadniNalozi.findAll({
      filters: {
        statusNaloga: { in: STARTABLE_STATUSES },
        deleted: { not: true },
      },
      limit: 500,
    });

    const filtered = records.filter((r) => {
      const pl = r.proizvodnaLinija;
      if (Array.isArray(pl)) return pl.includes(data.resursId);
      return pl === data.resursId;
    });

    // Resolve artikal names
    const artIds = new Set<string>();
    const kupacIds = new Set<string>();
    for (const r of filtered) {
      if (!r.artikalIzErPa) {
        const aid = Array.isArray(r.artikal) ? r.artikal[0] : r.artikal;
        if (aid && typeof aid === "string") artIds.add(aid);
      }
      const kRaw = (r as AnyRow).kupac ?? (r as AnyRow).narucilac;
      const kid = Array.isArray(kRaw) ? kRaw[0] : kRaw;
      if (typeof kid === "string" && kid.startsWith("rec")) kupacIds.add(kid);
    }
    const nameById = new Map<string, string>();
    if (artIds.size > 0) {
      try {
        const { records: arts } = await Artikli.findAll({
          filters: { recordId: { in: Array.from(artIds) } },
          limit: 500,
        });
        for (const a of arts) {
          if (typeof a.naziv === "string") nameById.set(a.id, a.naziv);
        }
      } catch (e) {
        console.warn("Failed to resolve artikal names:", e);
      }
    }
    const kupacById = new Map<string, string>();
    if (kupacIds.size > 0) {
      try {
        const { records: ks } = await Komitenti.findAll({
          filters: { recordId: { in: Array.from(kupacIds) } },
          limit: 500,
        });
        for (const k of ks) {
          if (typeof k.naziv === "string") kupacById.set(k.id, k.naziv);
        }
      } catch (e) {
        console.warn("Failed to resolve kupac names:", e);
      }
    }

    const items: AvailableWorkOrder[] = filtered.map((r) => {
      let artikalNaziv: string | undefined;
      if (typeof r.artikalIzErPa === "string") artikalNaziv = r.artikalIzErPa;
      else {
        const aid = Array.isArray(r.artikal) ? r.artikal[0] : r.artikal;
        if (aid && typeof aid === "string") artikalNaziv = nameById.get(aid);
      }
      const kRaw = (r as AnyRow).kupac ?? (r as AnyRow).narucilac;
      const kFirst = Array.isArray(kRaw) ? kRaw[0] : kRaw;
      let narucilac: string | undefined;
      if (typeof kFirst === "string") {
        narucilac = kFirst.startsWith("rec") ? kupacById.get(kFirst) : kFirst;
      }
      return {
        id: r.id,
        brojNaloga: typeof r.brojNaloga === "string" ? r.brojNaloga : undefined,
        statusNaloga: typeof r.statusNaloga === "string" ? r.statusNaloga : undefined,
        sifraArtikla: typeof r.sifraArtikla === "string" ? r.sifraArtikla : Array.isArray(r.sifraArtikla) ? String(r.sifraArtikla[0] ?? "") || undefined : undefined,
        artikalNaziv,
        planiranaKolicina: typeof r.planiranaKolicina === "number" ? r.planiranaKolicina : undefined,
        bukingSort: typeof r.bukingSort === "number" || typeof r.bukingSort === "string" ? r.bukingSort : undefined,
        planiranStart: typeof r.planiranStart === "string" ? r.planiranStart : undefined,
        narucilac,
      };
    });

    // Sortiranje: najpre po Planiran start, zatim po Buking sort
    // (oba Date and time, Earliest → Latest). Prazne vrednosti idu na kraj.
    const toTime = (v: unknown): number => {
      if (v == null || v === "") return Number.POSITIVE_INFINITY;
      if (typeof v === "number") return v;
      const t = Date.parse(String(v));
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    items.sort((a, b) => {
      const ps = toTime(a.planiranStart) - toTime(b.planiranStart);
      if (ps !== 0) return ps;
      return toTime(a.bukingSort) - toTime(b.bukingSort);
    });


    return { items };
    });
  });

// ============= Dropdown data (Grupe / Tipovi) =============
export interface DropdownGrupa { id: string; naziv: string; nameEn?: string; boja?: string }
export interface DropdownTip { id: string; naziv: string; nameEn?: string; grupaId?: string }

export const getDropdownDataFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ grupe: DropdownGrupa[]; grupeZastoj: DropdownGrupa[]; tipovi: DropdownTip[] }> => {
    return sharedMemoize("dropdown-data:v3", 10 * 60_000, async () => {
      const [gRes, gzRes, tRes] = await Promise.all([
        Grupe.findAll({ filters: { tip: "Škart" }, limit: 500 }),
        Grupe.findAll({ filters: { tip: "Zastoj" }, limit: 500 }),
        Tipovi.findAll({ limit: 1000 }),
      ]);
      const pickEn = (v: unknown): string | undefined => {
        const x = Array.isArray(v) ? v[0] : v;
        if (typeof x === "string") {
          const s = x.trim();
          return s ? s : undefined;
        }
        return undefined;
      };
      const mapGrupa = (g: AnyRow): DropdownGrupa => ({
        id: String(g.id),
        naziv: typeof g.naziv === "string" ? g.naziv : String(g.naziv ?? ""),
        nameEn: pickEn((g as Record<string, unknown>).name),
        boja: typeof g.boja === "string" ? g.boja : undefined,
      });
      const grupe = gRes.records.map(mapGrupa).filter((g) => g.naziv);
      const grupeZastoj = gzRes.records.map(mapGrupa).filter((g) => g.naziv);
      const tipovi: DropdownTip[] = tRes.records.map((t) => {
        const grupaId = Array.isArray(t.grupa) ? t.grupa[0] : t.grupa;
        return {
          id: t.id,
          naziv: typeof t.naziv === "string" ? t.naziv : String(t.naziv ?? ""),
          nameEn: pickEn((t as Record<string, unknown>).name),
          grupaId: typeof grupaId === "string" ? grupaId : undefined,
        };
      }).filter((t) => t.naziv);
      const byName = (a: { naziv: string }, b: { naziv: string }) => a.naziv.localeCompare(b.naziv, "sr");
      grupe.sort(byName);
      grupeZastoj.sort(byName);
      tipovi.sort(byName);
      return { grupe, grupeZastoj, tipovi };
    });
  },
);

// ============= Log Scrap (standalone) =============
interface ScrapInput {
  radniNalogId: string;
  resursId?: string;
  userId: string;
  kolicinaSkarta: number;
  grupaSkartaId: string;
  tipSkartaId: string;
  komentar?: string;
  clientOpId?: string;
  monitoringId?: string;
  prevSkart?: number;
  masaSkartaKg?: number;
}

function validateScrap(input: ScrapInput): ScrapInput {
  if (!input.radniNalogId) throw new Error("radniNalogId je obavezan");
  if (!(input.kolicinaSkarta > 0)) throw new Error("Količina škarta mora biti veća od 0");
  if (!input.grupaSkartaId) throw new Error("Grupa škarta je obavezna");
  if (!input.tipSkartaId) throw new Error("Tip škarta je obavezan");
  if (input.masaSkartaKg !== undefined && !(Number.isFinite(input.masaSkartaKg) && input.masaSkartaKg >= 0)) {
    throw new Error("Masa škarta (kg) mora biti broj >= 0");
  }
  return input;
}

async function createScrapRow(input: ScrapInput) {
  const record: Record<string, unknown> = {
    radniNalog: [input.radniNalogId],
    kreiraola: [input.userId],
    kolicinaSkarta: input.kolicinaSkarta,
    grupaSkarta: [input.grupaSkartaId],
    tipSkarta: [input.tipSkartaId],
  };
  // proizvodnaLinija je computed — ne upisuje se
  if (input.komentar) record.komentar = input.komentar;
  if (input.masaSkartaKg !== undefined) record.masaSkartaKg = input.masaSkartaKg;
  if (input.clientOpId) record.__extraFields = { clientOpId: input.clientOpId };
  await PromeneNaloga.create({ record });
}

export const logScrapFn = createServerFn({ method: "POST" })
  .middleware([requirePinSession])
  .inputValidator((input: Omit<ScrapInput, "userId"> & { userId?: string }) => validateScrap({ ...input, userId: "" }))
  .handler(async ({ data, context }) => {
    if (data.clientOpId) {
      const existing = await findIdByClientOpId("PromeneNaloga", data.clientOpId);
      if (existing) return { ok: true as const, deduped: true as const };
    }
    await createScrapRow({ ...data, userId: context.pin.userId });
    if (data.monitoringId) {
      const newSkart = (data.prevSkart ?? 0) + data.kolicinaSkarta;
      await upsertOverride(
        data.monitoringId,
        { skart: newSkart },
        { skartGte: newSkart },
      );
    }
    return { ok: true as const };
  });

// ============= Stop with Batch (Dobro + opcioni Škart) =============
interface StopBatchInput {
  radniNalogId: string;
  resursId?: string;
  userId: string;
  dobroProizvedeno: number;
  kolicinaSkarta?: number;
  grupaSkartaId?: string;
  tipSkartaId?: string;
  komentar?: string;
  clientOpId?: string;
  monitoringId?: string;
  masaSkartaKg?: number;
}

export const stopWorkOrderWithBatchFn = createServerFn({ method: "POST" })
  .middleware([requirePinSession])
  .inputValidator((input: Omit<StopBatchInput, "userId"> & { userId?: string }) => {
    if (!input.radniNalogId) throw new Error("radniNalogId je obavezan");
    if (!(input.dobroProizvedeno >= 0)) throw new Error("Dobro proizvedeno mora biti >= 0");
    if (input.kolicinaSkarta && input.kolicinaSkarta > 0) {
      if (!input.grupaSkartaId) throw new Error("Grupa škarta je obavezna kada se upisuje škart");
      if (!input.tipSkartaId) throw new Error("Tip škarta je obavezan kada se upisuje škart");
    }
    if (input.masaSkartaKg !== undefined && !(Number.isFinite(input.masaSkartaKg) && input.masaSkartaKg >= 0)) {
      throw new Error("Masa škarta (kg) mora biti broj >= 0");
    }
    return { ...input, userId: "" } as StopBatchInput;
  })
  .handler(async ({ data, context }) => {
    const userId = context.pin.userId;
    // Outbox dedupe na završnom redu (zatvaranje + dobroProizvedeno).
    if (data.clientOpId) {
      const existing = await findIdByClientOpId("PromeneNaloga", data.clientOpId);
      if (existing) return { ok: true as const, statusNaloga: "Završen", deduped: true as const };
    }

    // CAS guard — sprečava duplo zatvaranje. Dozvoljeno samo iz "U radu" ili "Pauziran".
    let wo: Awaited<ReturnType<typeof RadniNalozi.findOne>>;
    try {
      wo = await RadniNalozi.findOne({ id: data.radniNalogId });
    } catch {
      throw new Error("KONFLIKT: status naloga trenutno nedostupan. Pokušajte ponovo.");
    }
    if (!wo) throw new Error("Radni nalog nije pronađen");
    const airtableStatus: string = typeof wo.statusNaloga === "string" ? wo.statusNaloga : "";
    const allowedFrom = ["U radu", "Pauziran"];
    if (!allowedFrom.includes(airtableStatus)) throw conflictError(airtableStatus || "(nepoznat)");

    const acq = await acquireTransition({
      radniNalogId: data.radniNalogId,
      fromStatuses: allowedFrom,
      toStatus: "Završen",
      userId,
      airtableStatus,
    });
    if (!acq.ok) throw conflictError(acq.currentStatus);

    try {
      // 1) Optional scrap row (bez clientOpId — dedupe je na završnom redu)
      if (data.kolicinaSkarta && data.kolicinaSkarta > 0) {
        await createScrapRow({
          radniNalogId: data.radniNalogId,
          resursId: data.resursId,
          userId,
          kolicinaSkarta: data.kolicinaSkarta,
          grupaSkartaId: data.grupaSkartaId!,
          tipSkartaId: data.tipSkartaId!,
          masaSkartaKg: data.masaSkartaKg,
        });
      }
      // 2) Stop + dobroProizvedeno row
      await RadniNalozi.update({
        id: data.radniNalogId,
        record: { statusNaloga: "Završen" },
      });
      const promena: Record<string, unknown> = {
        radniNalog: [data.radniNalogId],
        kreiraola: [userId],
        zatvaranje: true,
        dobroProizvedeno: data.dobroProizvedeno,
      };
      if (data.komentar) promena.komentar = data.komentar;
      if (data.clientOpId) promena.__extraFields = { clientOpId: data.clientOpId };
      await PromeneNaloga.create({ record: promena });
    } catch (e) {
      await releaseTransition({
        radniNalogId: data.radniNalogId,
        expected: "Završen",
        revertTo: airtableStatus,
      }).catch(() => {});
      throw e;
    }
    if (data.monitoringId) {
      await upsertOverride(data.monitoringId, STOP_PATCH, STOP_EXPECTED);
    }
    await sharedInvalidate("available-wo");
    return { ok: true as const, statusNaloga: "Završen" };
  });

// ============= Confirm Batch (during run, not Stop) =============
interface ConfirmBatchInput {
  radniNalogId: string;
  userId: string;
  dobroProizvedeno: number;
  kolicinaSkarta?: number;
  komentar?: string;
  clientOpId?: string;
}

export const confirmBatchFn = createServerFn({ method: "POST" })
  .middleware([requirePinSession])
  .inputValidator((input: Omit<ConfirmBatchInput, "userId"> & { userId?: string }) => {
    if (!input.radniNalogId) throw new Error("radniNalogId je obavezan");
    if (!(input.dobroProizvedeno >= 0)) throw new Error("Dobro proizvedeno mora biti >= 0");
    return input;
  })
  .handler(async ({ data, context }) => {
    const record: Record<string, unknown> = {
      radniNalog: [data.radniNalogId],
      kreiraola: [context.pin.userId],
      dobroProizvedeno: data.dobroProizvedeno,
      komentar: data.komentar || `Potvrda serije: ${data.dobroProizvedeno} kom`,
    };
    if (data.kolicinaSkarta !== undefined) record.kolicinaSkarta = data.kolicinaSkarta;
    await PromeneNaloga.create({ record });
    // Override izostavljen: dobroProizvedeno je Airtable rollup; sustići će se na sledećem ciklusu.
    return { ok: true as const };
  });

// ============= Delete (soft) scrap entry =============
interface DeleteScrapInput {
  promenaId: string;
  userId: string;
  razlog: string;
}

export const deleteScrapEntryFn = createServerFn({ method: "POST" })
  .middleware([requirePinSession])
  .inputValidator((input: Omit<DeleteScrapInput, "userId"> & { userId?: string }) => {
    if (!input.promenaId) throw new Error("promenaId je obavezan");
    const razlog = (input.razlog ?? "").trim();
    if (razlog.length < 3) throw new Error("Razlog brisanja mora imati najmanje 3 karaktera");
    return { promenaId: input.promenaId, razlog };
  })
  .handler(async ({ data }) => {
    const rec = await PromeneNaloga.findOne({ id: data.promenaId });
    if (!rec) throw new Error("Zapis nije pronađen");
    if (rec.deleted === true) throw new Error("Zapis je već obrisan");
    const kol = typeof rec.kolicinaSkarta === "number" ? rec.kolicinaSkarta : 0;
    if (!(kol > 0)) throw new Error("Zapis nije škart");

    const existing = typeof rec.komentar === "string" ? rec.komentar.trim() : "";
    const novi = existing ? `${existing}\n[Brisanje]: ${data.razlog}` : `[Brisanje]: ${data.razlog}`;

    await PromeneNaloga.update({
      id: data.promenaId,
      record: { deleted: true, komentar: novi },
    });
    // Override izostavljen: brisanje škarta se odrazi na sledećem ciklusu Airtable cache-a.
    return { ok: true as const };
  });



// ============= Pomeri start =============
export const pomeriStartFn = createServerFn({ method: "POST" })
  .middleware([requirePinSession])
  .inputValidator((input: { radniNalogId: string; monitoringId?: string; prevPoceo?: string; clientOpId?: string }) => {
    if (!input?.radniNalogId) throw new Error("radniNalogId je obavezan");
    return input;
  })
  .handler(async ({ data, context }) => {
    // Server-side permission check
    const role = await Role.findOne({ id: context.pin.roleId }).catch(() => null);
    if (!role || (role as any).resetStart !== true) {
      throw new Error("Nemate dozvolu za ovu akciju.");
    }

    if (data.clientOpId) {
      const existing = await findIdByClientOpId("PromeneNaloga", data.clientOpId);
      if (existing) return { ok: true as const, deduped: true as const };
    }
    const record: Record<string, unknown> = {
      radniNalog: [data.radniNalogId],
      kreiraola: [context.pin.userId],
      pomeriStart: true,
    };
    if (data.clientOpId) (record as any).__extraFields = { clientOpId: data.clientOpId };
    await PromeneNaloga.create({ record });

    // Override: odmah nuliraj "Počeo" u dashboard prikazu; reconcile kad
    // Airtable promeni vremeOtvaranjaNaloga u odnosu na staru vrednost.
    if (data.monitoringId && data.prevPoceo) {
      await upsertOverride(
        data.monitoringId,
        { vremeOtvaranjaNaloga: null },
        { poceoNeq: data.prevPoceo },
      );
    }

    return { ok: true as const };
  });
