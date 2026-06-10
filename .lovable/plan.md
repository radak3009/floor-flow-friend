## Cilj
Kada je jezik aplikacije engleski, na svim mestima gde se prikazuju nazivi grupa i tipova (zastoji i škart) koristiti vrednost iz polja `Name`:
- Tabela Grupe: `fldNocNcamwJBs48A`
- Tabela Tipovi: `fldgP0gYzGcjxtnMR`

Ako polje `Name` nije popunjeno za zapis, prikazati postojeći (srpski) `naziv`. Za jezik `sr` uvek koristiti `naziv`.

## Izmene

### 1. Schema (`src/lib/airtable/schema.ts`)
Dodati ključ `name` u definicije tabela:
- `Grupe.name = "fldNocNcamwJBs48A"`
- `Tipovi.name = "fldgP0gYzGcjxtnMR"`

(Runtime config se već regeneriše iz Airtable labela; ovo je fallback i osigurava da kod uvek može da računa na `name` ključ kao codeKey. Po potrebi dodati alias u `FIELD_ALIASES` ako se label u Airtable razlikuje od „Name".)

### 2. Server: dropdown za zastoje/škart (`src/lib/api/workorder.functions.ts`)
U `getDropdownDataFn`:
- Proširiti `DropdownGrupa` i `DropdownTip` opcionim `nameEn?: string`.
- U mapperima čitati `g.name` / `t.name` i puniti `nameEn` kad postoji ne-prazan string.

### 3. Server: history (`src/lib/api/history.functions.ts`)
- `grupeMap` i `tipoviMap` promeniti iz `Map<string,string>` u `Map<string,{ sr: string; en?: string }>`.
- `resolveName` helper prima ciljani jezik i bira `en` ako postoji, inače `sr`.
- `getHistoryFn` (ili odgovarajući server fn) prihvata opcioni `lang: "sr" | "en"` u inputu; klijent ga šalje iz `i18n.language`.

### 4. Klijent: prikaz
Mali util `pickLocalizedName(item, lang)` u `src/lib/i18n/format.ts`:
```ts
export function pickName(item: { naziv: string; nameEn?: string }, lang: string) {
  return lang.startsWith("en") && item.nameEn ? item.nameEn : item.naziv;
}
```

Primeniti na:
- `src/components/shop-floor/DowntimeModal.tsx` — render `grupe` i `tipovi` (Select opcije + sort key).
- `src/components/work-order/dialogs.tsx` — render `grupe` i `tipovi` u dijalozima za škart.
- Bilo gde drugde gde se renderuje `g.naziv` / `t.naziv` iz dropdown podataka (proveriti `rg`).

Za istoriju: prosleđivati `i18n.language` u poziv server fn-a; server vraća već lokalizovane stringove pa UI ne mora ništa dodatno.

### 5. Sortiranje
U `getDropdownDataFn` zadržati sortiranje po `naziv` (srpski, `localeCompare("sr")`) da bi redosled ostao stabilan između jezika. Prikaz koristi lokalizovano ime, redosled ostaje isti.

### 6. Ne dirati
- Logiku snimanja zastoja/škarta (i dalje koristi recordId).
- Boje, grupisanje, filtere.
- Auth/PIN, persister, ostale ranije fix-ove.

## Validacija
- `bun run build`.
- Provera u UI:
  - SR → svi nazivi srpski (kao sada).
  - EN → prikazuju se engleski tamo gde je `Name` popunjen, fallback na srpski tamo gde nije.
  - Sortiranje konzistentno.
