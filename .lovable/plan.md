
## Cilj
Kroz celu aplikaciju (Monitoring, Shop Floor, Istorija, dijalozi) prikazivati **Krajnji kupac** umesto dosadašnjeg polja Kupac/Naručilac. Staro polje ostaje u schemi radi kompatibilnosti sa drugim delovima logike, ali se u UI-u više ne koristi.

## Airtable field ID-ovi
- `RadniNalozi.krajnjiKupac` = `fldq89upMoxTkFwpI` (lookup)
- `Monitoring.krajnjiKupac` = `fldTj0Ifw2LIRruKJ` (lookup)
- `Porudžbine.krajnjiKupac` = `fldZAUL4kVLjMfNW0` (linked record → Komitenti) — dodaje se u schemu radi konzistentnosti; ne koristi se za sada u čitanjima.

## Izmene po fajlu

### 1. `src/lib/airtable/schema.ts`
- U `RadniNalozi` dodati: `"krajnjiKupac": "fldq89upMoxTkFwpI"`.
- U `Monitoring` dodati: `"krajnjiKupac": "fldTj0Ifw2LIRruKJ"`.
- U `Porudzbine` (ako tabela postoji u schemi) dodati: `"krajnjiKupac": "fldZAUL4kVLjMfNW0"`.

### 2. `src/lib/airtable/required-schema.ts`
- Dodati `krajnjiKupac` u required listu za `RadniNalozi` i `Monitoring` (kao lookup polje), po istom obrascu kao postojeći `kupac`.

### 3. `src/lib/api/dashboard.functions.ts`
- Zameniti čitanje `kupac` sa `krajnjiKupac` na oba mesta (Monitoring row + WO row).
- `narucilac` resolver: koristiti `wo.krajnjiKupac ?? m.krajnjiKupac`. Lookup može vratiti string (naziv Komitenta) ili rec ID — postojeći `kupacMap` fallback ostaje isti, samo se izvor menja.
- `collectKupacId` skuplja iz `krajnjiKupac`.

### 4. `src/lib/api/workorder.functions.ts`
- U mapiranju liste dostupnih radnih naloga (`AvailableWorkOrder.narucilac`) čitati `r.krajnjiKupac` umesto `r.kupac ?? r.narucilac`.
- Skup `kupacIds` puniti iz `krajnjiKupac`.

### 5. `src/lib/api/history.functions.ts`
- Za listu Radnih naloga u Istoriji, `narucilac` popuniti iz `r.krajnjiKupac` (uz isti resolver preko `komitentiMap`).
- `komitentiIds` puniti iz `r.krajnjiKupac`.
- Napomena: PromeneNaloga (Škart istorija) ne dobija ovo polje — ostaje neizmenjeno.

### 6. UI
Nema izmena — svi ekrani već čitaju `narucilac` iz DTO-a, a taj DTO se sada puni iz "Krajnji kupac".

## Šta se NE menja
- Stara `kupac` mapiranja u schemi ostaju (druge logike ih možda koriste — npr. Komitenti.naziv resolver).
- Labeli u UI-u ("Naručilac") ostaju isti — samo se izvor podataka menja. Ako želiš da preimenujemo label u "Krajnji kupac", javi u sledećoj poruci.

## Verifikacija
- Build + tsgo.
- Otvoriti Monitoring karticu i Shop Floor: pod "Naručilac" prikazuje se vrednost iz Krajnji kupac.
- Istorija → Radni nalozi: kolona Naručilac prikazuje Krajnji kupac.
- Dijalog za pokretanje: naručilac odgovara Krajnjem kupcu iz WO.
