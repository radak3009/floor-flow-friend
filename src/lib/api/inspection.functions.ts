import { createServerFn } from "@tanstack/react-start";
import { Inspekcija, KontaktOsobe, uploadAttachment, resolveFieldId } from "@/lib/airtable/sdk.server";
import { findIdByClientOpId } from "@/lib/airtable/dedupe.server";

export type Kvalitet = "Dobro" | "Zadovoljava" | "Nezadovoljava" | "Neprihvatljivo" | "N/A";
export type Odstupanje = "OK" | "N/OK" | "N/A";

export interface AttachmentInput {
  filename: string;
  contentType: string;
  /** base64-encoded file content (no data: prefix) */
  file: string;
}

interface LogInspectionInput {
  radniNalogId: string;
  userId: string;
  brojIspitanogKomada: number;
  masaKomadaG?: number;
  vizuelno: Kvalitet;
  funkcionalno: Kvalitet;
  integralniKvalitet: Kvalitet;
  odstupanjeOdInstrukcija: Odstupanje;
  kolicinaNeusaglasenih?: number;
  komentar?: string;
  uzrokOdstupanja?: string;
  prilozi?: AttachmentInput[];
  clientOpId?: string;
}

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // Airtable upload endpoint limit per file

// Allowlist: PDF, JPEG, PNG, WebP, Excel, Google Docs/Sheets/Slides, videos
const ALLOWED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
  "video/x-matroska",
  "video/mpeg",
]);

const ALLOWED_EXTENSIONS = new Set<string>([
  "pdf",
  "jpg", "jpeg", "png", "webp",
  "xls", "xlsx",
  "gdoc", "gsheet", "gslides",
  "mp4", "mov", "webm", "avi", "mkv", "mpeg", "mpg",
]);

function getExtension(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function arrayify(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}

function creatorValues(r: any): unknown[] {
  return [
    ...arrayify(r.kreiraola),
    ...arrayify(r.kreiraoLa),
  ];
}

function resolveCreatorName(nameById: Map<string, string>, r: any): string | undefined {
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

export const logInspectionFn = createServerFn({ method: "POST" })
  .inputValidator((input: LogInspectionInput) => {
    if (!input.radniNalogId) throw new Error("radniNalogId je obavezan");
    if (!input.userId) throw new Error("userId je obavezan");
    if (!(input.brojIspitanogKomada > 0)) throw new Error("Broj ispitanog komada mora biti > 0");
    if (!input.vizuelno) throw new Error("Vizuelna ocena je obavezna");
    if (!input.funkcionalno) throw new Error("Funkcionalna ocena je obavezna");
    if (!input.integralniKvalitet) throw new Error("Integralni kvalitet je obavezan");
    if (!input.odstupanjeOdInstrukcija) throw new Error("Odstupanje od instrukcija je obavezno");
    if (input.prilozi) {
      for (const a of input.prilozi) {
        if (!a.filename || !a.file || !a.contentType) throw new Error("Nepotpun prilog");
        const approxBytes = Math.floor((a.file.length * 3) / 4);
        if (approxBytes > MAX_ATTACHMENT_BYTES) {
          throw new Error(`Prilog "${a.filename}" je veći od 5 MB`);
        }
        const mime = a.contentType.toLowerCase().split(";")[0].trim();
        if (!ALLOWED_MIME_TYPES.has(mime)) {
          throw new Error(`Nedozvoljen tip fajla "${a.filename}". Dozvoljeno: PDF, JPEG, PNG, WebP, Excel, Google Docs i video.`);
        }
        const ext = getExtension(a.filename);
        if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
          throw new Error(`Nedozvoljena ekstenzija fajla "${a.filename}".`);
        }
      }
    }
    return input;
  })
  .handler(async ({ data }) => {
    // Outbox dedupe
    if (data.clientOpId) {
      const existing = await findIdByClientOpId("Inspekcija", data.clientOpId);
      if (existing) return { ok: true as const, id: existing, deduped: true as const };
    }
    let kreiraola = data.userId;
    try {
      const user: any = await KontaktOsobe.findOne({ id: data.userId });
      if (user) kreiraola = user.imeIPrezime || user.ime || user.naziv || data.userId;
    } catch {
      // fall back to id
    }
    const record: Record<string, unknown> = {
      radniNalog: [data.radniNalogId],
      kreiraoLa: kreiraola,
      brojIspitanogKomada: data.brojIspitanogKomada,
      vizuelno: data.vizuelno,
      funkcionalno: data.funkcionalno,
      integralniKvalitet: data.integralniKvalitet,
      odstupanjeOdInstrukcija: data.odstupanjeOdInstrukcija,
    };
    // Airtable polje je `masaKomadaG` (grami) — šaljemo direktno bez konverzije.
    if (data.masaKomadaG !== undefined) record.masaKomadaG = data.masaKomadaG;
    if (data.kolicinaNeusaglasenih !== undefined) record.kolicinaNeusaglasenih = data.kolicinaNeusaglasenih;
    if (data.komentar) record.komentar = data.komentar;
    if (data.uzrokOdstupanja) record.uzrokOdstupanja = data.uzrokOdstupanja;
    if (data.clientOpId) record.__extraFields = { clientOpId: data.clientOpId };
    const created = await Inspekcija.create({ record });
    const recordId = (created as any).id as string;

    if (data.prilozi && data.prilozi.length) {
      const prilogFieldId = await resolveFieldId("Inspekcija", "prilog");
      for (const a of data.prilozi) {
        await uploadAttachment({
          recordId,
          fieldId: prilogFieldId,
          filename: a.filename,
          contentType: a.contentType,
          fileBase64: a.file,
        });
      }
    }

    return { ok: true as const, id: recordId };
  });

export interface InspekcijaRow {
  id: string;
  createdAt?: string;
  brojIspitanogKomada?: number;
  masaKomadaG?: number;
  vizuelno?: string;
  funkcionalno?: string;
  integralniKvalitet?: string;
  odstupanjeOdInstrukcija?: string;
  ukupnaOcena?: string;
  kolicinaNeusaglasenih?: number;
  komentar?: string;
  uzrokOdstupanja?: string;
  operator?: string;
}

export const getInspectionsForWorkOrderFn = createServerFn({ method: "GET" })
  .inputValidator((input: { radniNalogId: string; limit?: number }) => {
    if (!input.radniNalogId) throw new Error("radniNalogId je obavezan");
    return { radniNalogId: input.radniNalogId, limit: input.limit ?? 100 };
  })
  .handler(async ({ data }): Promise<{ items: InspekcijaRow[] }> => {
    const { records } = await Inspekcija.findAll({
      sort: [{ field: "datumKreiranja", direction: "desc" }],
      limit: 500,
    });

    const filtered = (records as any[]).filter((r) => {
      const link = r.radniNalog;
      return Array.isArray(link) ? link.includes(data.radniNalogId) : link === data.radniNalogId;
    }).slice(0, data.limit);

    const idSet = new Set<string>();
    for (const r of filtered) {
      for (const v of creatorValues(r)) if (typeof v === "string" && v.startsWith("rec")) idSet.add(v);
    }
    const nameById = new Map<string, string>();
    if (idSet.size > 0) {
      try {
        const { records: people } = await KontaktOsobe.findAll({
          filters: { recordId: { in: Array.from(idSet) } },
          limit: 200,
        });
        for (const p of people as any[]) {
          if (typeof p.imeIPrezime === "string") nameById.set(p.id, p.imeIPrezime);
        }
      } catch (e) {
        console.warn("Failed to resolve operator names:", e);
      }
    }

    const pickStr = (v: unknown): string | undefined => {
      if (Array.isArray(v)) v = v[0];
      return typeof v === "string" ? v : v != null ? String(v) : undefined;
    };
    const pickNum = (v: unknown): number | undefined => {
      if (Array.isArray(v)) v = v[0];
      return typeof v === "number" ? v : undefined;
    };

    const items: InspekcijaRow[] = filtered.map((r) => {
      // Polje fld3r0UC5dh24oDnk (kreiraoLa) u Inspekcijama je tekst i obično
      // već sadrži "Ime i Prezime" (vidi logInspectionFn). U starijim zapisima
      // može biti link (recXXX) na KontaktOsobe — pokušavamo da razrešimo i to.
      const operator = resolveCreatorName(nameById, r);
      return {
        id: r.id,
        createdAt: r.datumKreiranja as string | undefined,
        brojIspitanogKomada: pickNum(r.brojIspitanogKomada),
        masaKomadaG: pickNum((r as any).masaKomadaG),
        vizuelno: pickStr(r.vizuelno),
        funkcionalno: pickStr(r.funkcionalno),
        integralniKvalitet: pickStr(r.integralniKvalitet),
        odstupanjeOdInstrukcija: pickStr(r.odstupanjeOdInstrukcija),
        ukupnaOcena: pickStr(r.ukupnaOcena),
        kolicinaNeusaglasenih: pickNum(r.kolicinaNeusaglasenih),
        komentar: pickStr(r.komentar),
        uzrokOdstupanja: pickStr(r.uzrokOdstupanja),
        operator,
      };
    });

    return { items };
  });
