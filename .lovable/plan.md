## Cilj

Sav UI tekst u aplikaciji mora se prevoditi preko `react-i18next` (`t()`), tako da prebacivanjem jezika na EN sve forme, dijalozi, dugmad, toastovi i poruke budu na engleskom. Jedini izuzetak su vrednosti koje dolaze iz Airtable‑a (nazivi grupa/tipova, brojevi naloga, imena korisnika itd.); za njih i dalje važi pravilo: ako postoji EN `Name` u Airtable‑u, koristi njega, inače srpski naziv (već postojeća `pickName` logika).

## Šta je trenutno problem

Iako postoji `src/lib/i18n/locales/{sr,en}.json`, većina komponenti i dalje koristi hard‑koded srpski tekst:

- `src/components/work-order/dialogs.tsx` — "Upis škarta", "Količina škarta", "Grupa škarta", "Tip škarta", "Komentar (opciono)", "Zatvaranje radnog naloga", "Dobro proizvedeno", "Škart (opciono)", "Otkaži", "Sačuvaj", "Potvrdite akciju.", "Razlog...", placeholderi "Izaberite grupu", "Prvo izaberite grupu", "Nema tipova".
- `src/components/shop-floor/DowntimeModal.tsx` — "Prijava zastoja", "Aktivan zastoj počeo", "Grupa zastoja", "Tip zastoja", "Zastoj je u toku", "Isključi za podelu zastoja sa krajem.", "Kraj zastoja", placeholderi, toast poruke ("Zastoj definisan", "Zastoj podeljen", "Nema aktivnog zastoja...", "Kraj zastoja mora biti posle početka", "Neispravan datum/vreme...", "Unesite kraj zastoja.", "Sačuvano lokalno..."), "Učitavanje...", "Čuvanje...".
- `src/components/shop-floor/InspectionModal.tsx`, `StartWorkOrderDialog.tsx`, `WorkOrderDetailsDialog.tsx`, `ScrapDeleteButton.tsx` — naslovi dijaloga, labele, dugmad, toastovi.
- `src/routes/_auth/shop-floor.tsx`, `monitoring.tsx`, `istorija.tsx`, `podesavanja.*`, `setup.tsx` — naslovi sekcija, kolone tabela, prazna stanja, dugmad, statusne poruke, toastovi.

## Pristup

1. **Dopuni `src/lib/i18n/locales/sr.json` i `en.json`** novim ključevima grupisanim po ekranu/komponenti. Strogo paralelne strukture u oba fajla. Predlog name‑space‑ova:
   - `dialogs.scrap.*` (naslov, opis, polja, dugmad, toast poruke)
   - `dialogs.stop.*`, `dialogs.pause.*`, `dialogs.start.*`, `dialogs.resume.*` (već postoji deo — proširiti)
   - `dialogs.confirm.*` (opšti potvrdni dijalog: title, defaultDesc, naloziLine, komentarPlaceholder)
   - `downtime.*` (title, activeStartedAt, group, type, ongoing, ongoingHelp, end, noActive, errors.*, success.defined, success.split, savedLocally, saving, loading, firstPickGroup, noTypes)
   - `inspection.*`
   - `workOrder.details.*`, `workOrder.scrap.delete.*`
   - `shopFloor.*` — dopuna za sve preostale stringove
   - `monitoring.*`, `istorija.*` — dopuna kolona, praznih stanja, filtera
   - `settings.users.*`, `settings.roles.*`, `settings.pwa.*`, `settings.airtable.*`, `settings.mapping.*`
   - `setup.*`
   - `toast.common.*` (saved, error, queuedOffline — već postoji; dodati `loadError`, `actionFailed`, itd.)
   - `validation.*` (datumi, brojevi, obavezna polja)

2. **Zameni hard‑koded stringove `t("…")` pozivima** u svim fajlovima sa liste. Pravila:
   - `useTranslation()` na vrhu svake komponente; `const { t } = useTranslation();`.
   - Naslovi dijaloga, labele, placeholderi, dugmad, opisi — sve preko `t`.
   - Toast poruke (`toast.success/error/info`) — preko `t`. Greške koje stižu iz servera prikazivati kao `e.message || t("common.error")`.
   - Dinamičke poruke sa varijablama koriste interpolaciju: `t("downtime.errors.endAfterStart", { start: fmtDt(...) })`.
   - `fmtDt` u `DowntimeModal` i sličnim mestima koristi `formatDateTime` iz `src/lib/i18n/format.ts` umesto hard‑koded `"sr-RS"`.

3. **Globalna lokalizacija datuma/brojeva**: gde god se zove `toLocaleString("sr-RS")` direktno (npr. `DowntimeModal.fmtDt`), zameniti pozivom `formatDateTime` / `formatDate` iz `src/lib/i18n/format.ts` koji već prati `i18n.language`.

4. **Validacija**:
   - `bun run build` mora proći.
   - Ručna provera: prebaciti jezik na EN i otvoriti redom — Shop Floor (sva 4 dijaloga: Start, Pause, Stop, Scrap), Downtime modal, Inspection, Monitoring, Istorija (sve 4 kartice), Podešavanja (svi pod‑ekrani), Login/Setup. Nigde ne sme ostati ćirilični/latinični srpski tekst osim vrednosti iz Airtable‑a.
   - SR režim ostaje vizuelno identičan dosadašnjem.

## Granice (ne dirati)

- Logika snimanja (outbox, mutacije, server fn), persister, auth, schema mapiranje.
- Airtable vrednosti (grupe, tipovi, brojevi naloga, komentari korisnika) — `pickName` pravilo ostaje.
- Boje, layout, ponašanje, ranije fix‑ove.

## Tehnički detalji

- Za stringove koji se već koriste samo jednom i nisu deljivi, držati ih unutar smislenog name‑space‑a (npr. `dialogs.scrap.title`) — ne praviti generički `misc.*`.
- `Number.isNaN` poruke i sl. tehničke poruke takođe prevoditi (korisnik ih vidi u toast‑u).
- Gde je `DialogDescription` uslovno ("Nalog X" ili "Potvrdite akciju."), koristiti `t("dialogs.confirm.withOrder", { broj })` vs `t("dialogs.confirm.default")`.
- Date input (`<Input type="datetime-local">`) ostaje native (po memoriji projekta) — samo labela ide kroz `t()`.

## Rizici

- Veliki broj fajlova → rizik od propusta. Mitigacija: posle izmena pokrenuti `rg` za karakteristične srpske reči (`Otkaži|Sačuvaj|Izaberite|Količina|Komentar|Nalog|Zastoj|Škart|Učitavanje|Greška`) van `src/lib/i18n/locales/sr.json` — rezultat mora biti prazan ili samo komentari/Airtable codeKey labele.
- Promena `fmtDt` na `formatDateTime` može dati malo drugačiji format u SR (i dalje `sr-Latn-RS`), što je prihvatljivo i konzistentno sa ostatkom aplikacije.
