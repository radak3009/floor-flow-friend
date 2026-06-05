# Robustan Remix — dopuna bootstrap wizard-a

## Cilj
Zatvoriti rupe da remix aplikacije na novu Airtable bazu + novi Supabase projekat radi glatko, bez tihih otkaza. Postojeći mehanizam ručnog mapiranja ostaje netaknut — samo se proširuje.

## Promene po fajlovima

### 1) `src/lib/airtable/required-schema.ts`
**REQUIRED_SCHEMA dopune:**
- `PromeneNaloga`: dodati `pomeriStart` (Boolean — akcija „Pomeri start").
- `Monitoring`: dodati `grupa` (lookup grupe zastoja) i `tip` (lookup tipa zastoja).
- Verifikovati da su prisutna: `Monitoring.statusMasine`, `statusNaloga`, `radniNalog`; `RadniNalozi.vremeOtvaranjaNaloga`, `brojNaloga`, `planiranaKolicina`, `skart` — sva već postoje, samo provera.

Opciona polja (NE u REQUIRED_SCHEMA, ali navedena u dokumentaciji): `performanseFinal`, `procenjenoTrajanjeDhmin`, `masaKomadaG`, `alatLookup`.

**REQUIRED_AUTOMATIONS dopune** (svaka sa trigger/action/why za Super Admin checklist):
1. `pomeri-start` — PromeneNaloga.pomeriStart=true → ažurira `RadniNalozi.vremeOtvaranjaNaloga`.
2. `status-propagacija` — promene PromeneNaloga (start/pauza/stop) → `Monitoring.statusNaloga`/`statusMasine`.
3. `link-nalog-na-liniju` — start naloga → `Monitoring.radniNalog` link.
4. `rollup-skart-dobro` — PromeneNaloga.kolicinaSkarta/dobroProizvedeno → rollup na `RadniNalozi.skart`/Monitoring.
5. `grupa-tip-zastoja` — definisanje zastoja → `Monitoring.grupa`/`tip`.
6. `stop-raskid-veze` — stop → `Monitoring.radniNalog` se prazni / `brojNaloga` prazan.

### 2) Supabase readiness — nova serverska funkcija
Dodati u `src/lib/airtable/bootstrap.functions.ts`:
- `getSupabaseReadinessFn` — proverava postojanje tabela: `machine_overrides`, `wo_status_locks`, `airtable_cache`, `login_attempts`, `comments`, `notifications`, `pwa_config`, `airtable_config`. Po tabeli: `supabaseAdmin.from(t).select('*', { head: true, count: 'exact' }).limit(0)`; hvatati `relation does not exist`. Vraća `{ table, ok, error? }[]`.

### 3) Smoke-test (aktivna provera upisa + PAT write scope)
Dodati u `bootstrap.functions.ts`:
- `bootstrapSmokeTestFn` — radi sve sledeće i vraća strukturiran rezultat:
  - **PAT write scope check**: pokušava create u `PromeneNaloga` (minimalan red samo sa komentarom „__smoke_test__") pa odmah delete. Hvata 403/422/itd. i vraća Airtable poruku.
  - **PrijaveNaSistem upis test**: create + delete u toj tabeli.
  - Vraća `{ patWriteOk, prijaveOk, promeneOk, errors: {...} }`.

### 4) `src/routes/setup.tsx` — UI dopune wizarda
- Nova sekcija „Supabase tabele" sa listom (✅/❌) na osnovu `getSupabaseReadinessFn`. Ako nešto fali — upozorenje „Primeni migracije iz supabase/migrations/".
- Nova sekcija „Obavezne automatizacije" — render `REQUIRED_AUTOMATIONS` kao checklist (Super Admin ručno čekira da je uključio).
- Završni korak „Smoke test" — dugme „Pokreni proveru" → poziva `bootstrapSmokeTestFn`, prikazuje ✅/❌ po stavci sa konkretnom Airtable porukom kad padne.

### 5) Soft-fail logovanje (`auth.functions.ts`, gde je relevantno)
U postojećim soft-fail `console.warn` blokovima (PrijaveNaSistem.create/update, PromeneNaloga.create) — proširiti poruku: uključiti naziv tabele + Airtable error message (ako postoji), forma: `[soft-fail] PrijaveNaSistem.create — ${tableId}: ${err.message}`. Ne menja ponašanje (nastavlja flow), samo bolji dijagnostički log.

### 6) `REMIX.md` (novi fajl u root)
Kratak vodič: PAT+BaseID → regeneracija → mapiranje nedostajućih polja → Supabase migracije → automatizacije iz checklist-a → smoke test. Spisak obaveznih automatizacija + opcionih polja za mapiranje.

## Tehnički detalji
- Sve nove serverske funkcije idu kroz `assertBootstrapAllowed()` kao postojeće (bootstrap mode ili `X-Setup-Token`).
- Supabase provera koristi `supabaseAdmin` direktno (server-only, već uvezeno u sličnim file-ovima).
- Smoke-test koristi postojeći `loadActiveConfig()` da dobije PAT/baseId/tableId, kao i postojeći mapped field IDs (`config.fields`).
- UI: `useMutation` za smoke test, `useQuery` za readiness, postojeći Card/Badge primitivi.

## Šta NE diramo
- Postojeći flow `bootstrapSaveCredsFn`/`Regenerate`/`ApplyOverrides`.
- Postojeće soft-fail try/catch ponašanje u produkciji (samo poruka loga je bolja).
- `REQUIRED_SCHEMA` postojeća polja ostaju nepromenjena.
