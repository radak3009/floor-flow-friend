/**
 * Idempotencija za outbox: provera da li već postoji zapis sa datim clientOpId.
 * Koristi raw Airtable formulu po polju `clientOpId` (field name).
 *
 * Polje `clientOpId` mora postojati u Airtable tabelama:
 *   PromeneNaloga, Inspekcija, Zastoji, RadniNalozi
 *
 * Ne mora biti u statičkoj schema.ts mapi — koristimo field name direktno.
 */
import { rawAirtableRequest, getActiveBaseAndTable } from "./sdk.server";
import type { TableName } from "./schema";

function escFormula(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Vraća ID postojećeg zapisa sa datim clientOpId, ili null ako ne postoji. */
export async function findIdByClientOpId(
  table: TableName,
  clientOpId: string,
): Promise<string | null> {
  if (!clientOpId) return null;
  const { baseId, tableId } = await getActiveBaseAndTable(table);
  const formula = `{clientOpId} = "${escFormula(clientOpId)}"`;
  const params = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
    returnFieldsByFieldId: "true",
  });
  try {
    const data = await rawAirtableRequest(`/v0/${baseId}/${tableId}?${params.toString()}`);
    const rec = data?.records?.[0];
    return rec?.id ?? null;
  } catch (e) {
    // Ako Airtable vrati grešku (npr. polje ne postoji), ne blokiramo upis.
    console.warn(`[dedupe] findIdByClientOpId(${table}) greška:`, (e as Error)?.message);
    return null;
  }
}
