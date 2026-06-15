## Cilj

Dodati polje **Masa škarta (kg)** u dijalog za unos škarta (i u Shop Floor i u Monitoring tabu, kao i u Stop dijalogu koji takođe upisuje škart), koje se prikazuje **samo** kada je odabrani Tip škarta jedan od:
- `Pogača - pokretanje linije`
- `Pogača - promena boje`

Polje se postavlja **ispod "Tip škarta"** i **iznad "Komentar"**.

## Izmene

### 1. `src/lib/airtable/schema.ts`
U `PromeneNaloga` dodati mapiranje:
```
"masaSkartaKg": "fld5TFBnsiHsMVlm9"
```

### 2. `src/components/work-order/dialogs.tsx`
- `ScrapPayload` i `StopPayload`: dodati opcioni `masaSkartaKg?: number`.
- U `ScrapDialog` i `StopWithBatchDialog`:
  - dodati `useState` za `masaSkarta` (string) i resetovati ga u `reset()`.
  - dovući `tipovi` (preko `getDropdownDataFn` query-ja sa istim `queryKey: ["dropdown-data"]`) i pronaći ime trenutno odabranog tipa.
  - normalizovati ime (`trim`, lowercase) i porediti sa listom triger naziva: `["pogača - pokretanje linije", "pogača - promena boje"]` (tolerantno na različite crtice `-`, `–`, `—`).
  - kada se uslov ispuni, renderovati novo polje **između** `ScrapGroupTypeSelectors` i `Komentar`:
    - Label: `Masa škarta (kg)`
    - `Input type="number"` sa `step="0.01"`, `min={0}`, `inputMode="decimal"`.
  - kada uslov nije ispunjen, ne renderovati polje i ne slati vrednost.
  - u `onConfirm` payload-u dodati `masaSkartaKg: shouldShow && masaSkarta ? Number(masaSkarta) : undefined`.
  - validacija: kada je polje vidljivo, dozvoliti slanje samo ako je broj `>= 0` (ako je obavezno, postaviti `> 0`). Predlog: tretirati kao opciono — ako korisnik unese vrednost mora biti validan broj `>= 0`; prazno polje šalje `undefined`.

Napomena: `ScrapGroupTypeSelectors` već koristi isti query (`queryKey: ["dropdown-data"]`), pa dohvatanje istih podataka u dijalogu ne pravi dodatni mrežni poziv (cache hit).

### 3. `src/lib/api/workorder.functions.ts`
- `ScrapInput` i `StopBatchInput`: dodati `masaSkartaKg?: number`.
- `validateScrap` / `stopWorkOrderWithBatchFn` validator: ako je prosleđeno, mora biti broj `>= 0` (`Number.isFinite`).
- `createScrapRow`: ako je `input.masaSkartaKg !== undefined`, upisati `record.masaSkartaKg = input.masaSkartaKg`.
- `stopWorkOrderWithBatchFn`: proslediti `masaSkartaKg` u `createScrapRow` poziv.

### 4. `src/lib/i18n/locales/sr.json`
Dodati ključeve u `dialogs.scrap`:
- `massLabel`: "Masa škarta (kg)"
- `massPh`: "0"

(I odgovarajuće u `en.json` ako postoji.)

### 5. Pozivaoci `ScrapDialog` / `StopWithBatchDialog`
Pozivaoci u `src/routes/_auth/monitoring.tsx` i `src/routes/_auth/shop-floor.tsx` već prosleđuju ceo `payload` u serverFn — proširenjem tipa `ScrapPayload`/`StopPayload` polje automatski stiže do `logScrapFn`/`stopWorkOrderWithBatchFn`. Treba samo proveriti da se payload prosleđuje "as-is" (bez ručnog mapiranja polja). Ako se polja navode pojedinačno, dodati `masaSkartaKg`.

## Ponašanje (UX)

- Promena Tipa škarta na jedan od dva triger naziva → polje "Masa škarta (kg)" se pojavljuje (prazno).
- Promena na bilo koji drugi tip → polje se sakriva, a unesena vrednost se odbacuje (ne šalje se serveru).
- Polje radi identično u dijalogu otvorenom sa Shop Floor i sa Monitoring taba.
