# Dodavanje polja u Inspekciju: Masa ulivka (kg) i Materijal

## 1) Schema (`src/lib/airtable/schema.ts`)
U `PromeneNaloga` dodati dva nova field ID-ja:
- `masaUlivkaKg: "fldcuIHqq0pDQ8ScZ"`
- `materijal: "fldjfRRPzxkPFrHPc"`

Polja su opcionalna — NE dodaju se u `REQUIRED_SCHEMA`.

## 2) Server: opcije za Materijal
Nova serverska funkcija u `src/lib/api/inspection.functions.ts`:
- `getMaterijalOptionsFn` — preko Airtable Metadata API (`/v0/meta/bases/{baseId}/tables`) čita field `materijal` iz `PromeneNaloga` i vraća `options.choices[].name`. Rezultat se kešira u modulu (in-memory) na nivou servera ~10 min da se ne udara meta API na svako otvaranje forme.

## 3) Inspection server fn (`src/lib/api/inspection.functions.ts`)
- Proširiti `LogInspectionInput` sa:
  - `masaUlivkaKg?: number`
  - `materijal?: string[]` (multipleSelect)
- U `handler` upisati u `record`:
  - ako je definisano: `record.masaUlivkaKg = data.masaUlivkaKg`
  - ako je niz neprazan: `record.materijal = data.materijal`
- Proširiti `InspekcijaRow` i mapiranje u `getInspectionsForWorkOrderFn`:
  - `masaUlivkaKg?: number`
  - `materijal?: string[]`

## 4) Forma za unos (`src/components/shop-floor/InspectionModal.tsx`)
- Dodati state: `masaUlivkaKg: string`, `materijal: string[]`.
- Polje **Masa ulivka (kg)** — `Input type="number" step="0.01" min={0}` — UMETNUTI ODMAH IZA "Masa komada (g)" polja.
- Polje **Materijal** — multi-select sa pretragom po nazivu (shadcn `Command` + `Popover` + `Checkbox` pattern, kao kombobox sa selektovanjem više vrednosti i prikazom badge-eva ispod). Opcije se učitavaju preko `useQuery` koji zove `getMaterijalOptionsFn`. Postaviti ODMAH IZA "Masa ulivka (kg)" a ISPRED "Vizuelno".
- Reset na otvaranje (`useEffect` na `open`) — resetovati i nove vrednosti.
- Pri submit-u prosleđivati `masaUlivkaKg` (broj ili undefined) i `materijal` (string[] ili undefined) u `enqueue("logInspection", …)`.

## 5) Detalji radnog naloga — tab Inspekcija (`src/components/work-order/WorkOrderDetailsDialog.tsx`)
U `InspekcijaList` (red sa grid `text-xs text-muted-foreground`) dodati:
- `{it.masaUlivkaKg != null && <div>Masa ulivka (kg): <span className="text-foreground">{it.masaUlivkaKg.toLocaleString("sr",{maximumFractionDigits:3})}</span></div>}`
- `{it.materijal?.length ? <div>Materijal: <span className="text-foreground">{it.materijal.join(", ")}</span></div> : null}`

## 6) Tip outbox payload-a (`src/lib/offline/runners.ts` / `outbox.ts`)
Ako su tipovi striktni za `logInspection`, dopuniti payload tip sa istim novim opcionim poljima da TS prođe.

## Napomena
- "Masa komada" u formi je tehnički u gramima (UI label "Masa komada (g)") i konvertuje se u `izmerenaMasaKg`. Novo polje **Masa ulivka (kg)** ide direktno u `masaUlivkaKg` kao kg (bez konverzije), prema specifikaciji korisnika.
- `materijal` je `multipleSelects` u Airtable-u — opcije se ne hardkoduju, već povlače sa meta API-ja, što omogućava da se kasnije dodaju nove vrednosti u Airtable bez deploya.
