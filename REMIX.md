# Remix vodič — povezivanje aplikacije sa NOVOM Airtable bazom

Ovaj vodič opisuje korake nakon što kopiraš (remix) projekat i povežeš ga sa drugom Airtable bazom + drugim Lovable Cloud (Supabase) projektom. Sve se prolazi kroz wizard na ruti **`/setup`** (dostupan dok god ne postoji validna Airtable mapa).

## Redosled koraka

1. **PAT + Base ID** — kreiraj Personal Access Token na <https://airtable.com/create/tokens> sa scope-ovima:
   - `schema.bases:read`
   - `data.records:read`
   - `data.records:write` ⚠️ **obavezno** (bez ovog scope-a sve akcije tiho ne upisuju)

   Dodaj svoj Base na PAT i unesi PAT + Base ID u wizard.

2. **Regeneracija mape** — wizard povuče strukturu nove baze i pokuša da poveže polja po nazivu.

3. **Validacija obaveznih polja** — wizard prikaže polja koja ne može da nađe po nazivu (npr. "Masa komada (kg)" vs "Masa komad (g)"). Super Admin ručno bira polje iz baze za svaki nedostajući ključ.

4. **Airtable automatizacije** — checklist obaveznih automatizacija koje moraš napraviti ručno u Airtable-u (Aplikacija ne može da ih instalira preko API-ja). Vidi spisak ispod.

5. **Supabase tabele** — wizard proverava da li su sve potrebne Lovable Cloud tabele dostupne. Ako nešto fali → primeni migracije iz `supabase/migrations/` na novi projekat. (Spisak tabela ispod.)

6. **Smoke test** — aktivna provera upisa u kritične tabele (`PromeneNaloga`, `PrijaveNaSistem`). Otkriva tihe otkaze koje produkcioni soft-fail blokovi inače zataškavaju.

7. **Završetak** — prijavi se sa Super Admin korisnikom iz nove baze.

## Obavezne Airtable automatizacije

Bez ovih, override sloj visi do TTL-a (~120s) i podaci se ne ažuriraju korektno na Monitoring kartici / detaljima naloga:

| ID | Triger | Akcija |
|---|---|---|
| `promene-start-fallback` | PromeneNaloga.pokretanje=true AND start prazno | Postavi start = NOW() |
| `pomeri-start` | PromeneNaloga.pomeriStart=true | Update RadniNalozi.vremeOtvaranjaNaloga |
| `status-propagacija-monitoring` | Promene statusa (start/pauza/stop) | Update Monitoring.statusNaloga + statusMasine |
| `link-nalog-na-liniju` | Start naloga | Update Monitoring.radniNalog = link |
| `rollup-skart-dobro` | PromeneNaloga sa škartom/dobro | Rollup na RadniNalozi.skart / ispravnoProizvedeno |
| `grupa-tip-zastoja` | Definisanje zastoja | Update Monitoring.grupa + tip |
| `stop-raskid-veze` | Stop naloga | Monitoring.radniNalog = prazno |

Tačne tekstove triger/akcija prikazuje wizard u koraku 4.

## Potrebne Supabase (Lovable Cloud) tabele

Wizard (korak 5) proverava postojanje sledećih tabela. Ako neka fali, override sloj, zaključavanje (konkurentnost), keš i throttle prijave neće raditi — primeni migracije iz `supabase/migrations/`:

| Tabela | Čemu služi |
|---|---|
| `machine_overrides` | Trenutna vidljivost akcija (override sloj) pre Airtable automatizacije |
| `wo_status_locks` | Zaključavanje tranzicija naloga (sprečava duplo start/stop) |
| `airtable_cache` | Deljeni keš dashboard-a za celu flotu (štedi Airtable pozive) |
| `login_attempts` | Throttle/lockout neuspelih prijava |
| `comments` | Komentari/chat na nalozima |
| `notifications` | Notifikacije (zvonce) |
| `pwa_config` | PWA podešavanja |
| `airtable_config` | Aktivna Airtable mapa (PAT/Base/field mapping) — srce bootstrap-a |

**Napomena:** Lovable obično primeni migracije pri remiksu automatski, ali wizard svejedno proverava — ako vidiš ❌, ručno pokreni migracije na novom Supabase projektu.

## Opciona polja (prikaz „—" ako nisu mapirana)

Ova polja **NE** blokiraju login/remix; ako nisu prisutna, UI prikazuje „—" na odgovarajućim mestima. Mapiraj ih kasnije ako su ti potrebna:

- `RadniNalozi.performanseFinal` — prikaz OEE/performansi
- `RadniNalozi.procenjenoTrajanjeDhmin` — procena trajanja
- `RadniNalozi.masaKomadaG` — masa komada (naziv varira: kg vs g)
- `RadniNalozi.alatLookup` — prikaz alata na nalogu

## Soft-fail upisi (dijagnostika)

Sledeći upisi su namerno „soft-fail" (greška se loguje, flow nastavlja):

- `PrijaveNaSistem.create` pri loginu (audit prijava)
- `PrijaveNaSistem.update` pri logoutu (audit odjava)
- Akcijski upisi u `PromeneNaloga` — start/pauza/nastavak/stop, škart, zastoj, „Pomeri start" (deo akcija je soft-fail ili ide kroz offline outbox)

Svi ovi upisi zavise od `data.records:write` scope-a na PAT-u. U produkciji soft-fail daje stabilnost, ali pri remiksu krije probleme (npr. „ne beleže se prijave", „škart se ne upisuje"). Zato: **uvek pokreni Smoke test u wizardu** — on aktivno proverava `PromeneNaloga` i `PrijaveNaSistem` i prikazuje konkretnu Airtable poruku (npr. „PAT nema write scope", „obavezno polje nije popunjeno") koju bi inače propustio.

## Završna provera (funkcionalni test posle wizarda)

Smoke test potvrđuje da upisi rade, ali ovo potvrđuje da ceo override tok radi sa novim automatizacijama. Posle koraka 7 proveri ručno:

1. **Login** sa Super Admin korisnikom iz nove baze radi i `PrijaveNaSistem` dobije nov red.
2. **Dashboard** (Monitoring / Shop Floor) se učita iz prvog puta.
3. **Test akcija** na test mašini (npr. pauza pa nastavak):
   - u Supabase tabeli `machine_overrides` se pojavi red (patch/expected),
   - kartica reaguje u ≤3s bez ručnog osvežavanja,
   - kad Airtable automatizacija sustigne, override red se sam obriše.
4. **„Pomeri start"** (ako se koristi): „Počeo" se odmah isprazni pa pređe na novu vrednost kad automatizacija `pomeri-start` odradi.

Ako neki korak zakaže: proveri odgovarajuću automatizaciju (sekcija iznad) i Supabase tabele (korak 5).

## Re-bootstrap nakon konfiguracije

Wizard je dostupan SAMO dok ne postoji validna mapa. Za naknadne izmene:
- **Polja**: Podešavanja → Airtable
- **Pun re-bootstrap**: pošalji header `X-Setup-Token: <SETUP_TOKEN>` (secret) na `/setup`.
