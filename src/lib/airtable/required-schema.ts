/**
 * Eksplicitna lista polja koja aplikacija OBAVEZNO zahteva da bi bootstrap+login radio.
 * Koristi se u bootstrap wizardu kao validacija nakon regeneracije šeme.
 *
 * Ako se ovde doda novo polje, treba ga dodati i u kod koji ga koristi.
 * "label" je tekst koji vidi Super Admin u UI-u kad mu se traži ručno mapiranje.
 */

export interface RequiredField {
  key: string; // camelCase kao u kodu (npr. "idZaposlenog")
  label: string; // ljudski opis za UI ("ID zaposlenog")
  hint?: string; // dodatno objašnjenje
}

export interface RequiredTable {
  table: string; // camelCase ime tabele (npr. "KontaktOsobe")
  label: string;
  fields: ReadonlyArray<RequiredField>;
}

export const REQUIRED_SCHEMA: ReadonlyArray<RequiredTable> = [
  {
    table: "KontaktOsobe",
    label: "Kontakt osobe (korisnici)",
    fields: [
      { key: "idZaposlenog", label: "ID zaposlenog", hint: "Koristi se za login" },
      { key: "pin", label: "PIN", hint: "Login PIN" },
      { key: "aktivan", label: "Aktivan", hint: "Boolean — da li je nalog aktivan" },
      { key: "imeIPrezime", label: "Ime i prezime" },
      { key: "uloga", label: "Uloga", hint: "Link na Role tabelu" },
    ],
  },
  {
    table: "Role",
    label: "Role (dozvole)",
    fields: [
      { key: "naziv", label: "Naziv uloge", hint: "Super Admin se prepoznaje po nazivu" },
      { key: "viewAssignedMachines", label: "viewAssignedMachines" },
      { key: "viewAllFactoryMachines", label: "viewAllFactoryMachines" },
      { key: "startWorkOrder", label: "startWorkOrder" },
      { key: "pauseWorkOrder", label: "pauseWorkOrder" },
      { key: "resumeWorkOrder", label: "resumeWorkOrder" },
      { key: "stopWorkOrder", label: "stopWorkOrder" },
      { key: "resetStart", label: "resetStart" },
      { key: "logScrap", label: "logScrap" },
      { key: "deleteScrap", label: "deleteScrap" },
      { key: "logDowntime", label: "logDowntime" },
      { key: "confirmBatch", label: "confirmBatch" },
      { key: "performInspection", label: "performInspection" },
      { key: "viewHistory", label: "viewHistory" },
      { key: "manageUsers", label: "manageUsers" },
      { key: "manageSettings", label: "manageSettings" },
      { key: "manageReasonCodes", label: "manageReasonCodes" },
      { key: "viewReports", label: "viewReports" },
      { key: "manageFactoryScope", label: "manageFactoryScope" },
      { key: "canComment", label: "canComment" },
    ],
  },
  {
    table: "PrijaveNaSistem",
    label: "Prijave na sistem (audit log logovanja)",
    fields: [
      { key: "datumIVremePrijave", label: "Datum i vreme prijave" },
      { key: "datumIVremeOdjave", label: "Datum i vreme odjave" },
      { key: "korisnik", label: "Korisnik (link KontaktOsobe)" },
    ],
  },
  {
    table: "PromeneNaloga",
    label: "Promene naloga (audit akcija)",
    fields: [
      { key: "radniNalog", label: "Radni nalog", hint: "Link na RadniNalozi" },
      { key: "start", label: "Start", hint: "Datetime — početak akcije / segmenta proizvodnje" },
      { key: "kraj", label: "Kraj", hint: "Datetime — kraj akcije" },
      { key: "pokretanje", label: "Pokretanje", hint: "Boolean — akcija start" },
      { key: "pauziranje", label: "Pauziranje", hint: "Boolean — akcija pauza" },
      { key: "reaktivacija", label: "Reaktivacija", hint: "Boolean — akcija nastavak" },
      { key: "zatvaranje", label: "Zatvaranje", hint: "Boolean — akcija stop" },
      { key: "komentar", label: "Komentar" },
      { key: "kreiraola", label: "Kreirao/la", hint: "Link na KontaktOsobe" },
      { key: "statusNaloga", label: "Status naloga (lookup)" },
      { key: "dobroProizvedeno", label: "Dobro proizvedeno" },
      { key: "kolicinaSkarta", label: "Količina škarta" },
      { key: "grupaSkarta", label: "Grupa škarta" },
      { key: "tipSkarta", label: "Tip škarta" },
      { key: "zastoj", label: "Zastoj", hint: "Link na Zastoji" },
      { key: "statusZastoja", label: "Status zastoja" },
      { key: "datumKreiranja", label: "Datum kreiranja" },
      { key: "pomeriStart", label: "Pomeri start", hint: "Boolean — akcija „Pomeri start”" },
    ],
  },
  {
    table: "RadniNalozi",
    label: "Radni nalozi",
    fields: [
      { key: "brojNaloga", label: "Broj naloga" },
      { key: "statusNaloga", label: "Status naloga" },
      { key: "planiranaKolicina", label: "Planirana količina" },
      { key: "proizvodnaLinija", label: "Proizvodna linija (link Resursi)" },
      { key: "artikal", label: "Artikal" },
      { key: "sifraArtikla", label: "Šifra artikla" },
      { key: "vremeOtvaranjaNaloga", label: "Vreme otvaranja naloga" },
      { key: "vremeZatvaranjaNaloga", label: "Vreme zatvaranja naloga" },
      { key: "ispravnoProizvedeno", label: "Ispravno proizvedeno" },
      { key: "skart", label: "Škart" },
      { key: "preostaloMaterijalaKg", label: "Preostalo materijala (kg)" },
      { key: "krajnjiKupac", label: "Krajnji kupac (lookup)", hint: "Lookup iz Porudžbine → Komitenti" },
      { key: "monitoring", label: "Monitoring (link)" },
    ],
  },
  {
    table: "Monitoring",
    label: "Monitoring (mašine)",
    fields: [
      { key: "nazivLinije", label: "Naziv linije" },
      { key: "statusMasine", label: "Status mašine" },
      { key: "radniNalog", label: "Radni nalog (link)" },
      { key: "proizvodnaLinija", label: "Proizvodna linija (link Resursi)" },
      { key: "dobroProizvedeno", label: "Dobro proizvedeno" },
      { key: "skart", label: "Škart" },
      { key: "statusNaloga", label: "Status naloga (lookup)" },
      { key: "aktivnoZastoja", label: "Aktivno zastoja" },
      { key: "grupa", label: "Grupa zastoja (lookup)", hint: "Prikazuje se u override-u dok Airtable ne sustigne" },
      { key: "tip", label: "Tip zastoja (lookup)", hint: "Prikazuje se u override-u dok Airtable ne sustigne" },
      { key: "krajnjiKupac", label: "Krajnji kupac (lookup)", hint: "Lookup preko RN → Porudžbine → Komitenti" },
    ],
  },
  {
    table: "Resursi",
    label: "Resursi (proizvodne linije)",
    fields: [
      { key: "naziv", label: "Naziv" },
      { key: "monitoring", label: "Monitoring (link)" },
      { key: "podrazumevanaLinija", label: "Podrazumevana linija" },
      { key: "idResursa", label: "ID resursa" },
    ],
  },
  {
    table: "Zastoji",
    label: "Zastoji",
    fields: [
      { key: "radniNalog", label: "Radni nalog (link)" },
      { key: "proizvodnaLinija", label: "Proizvodna linija (link)" },
      { key: "statusZastoja", label: "Status zastoja" },
      { key: "start", label: "Start" },
      { key: "kraj", label: "Kraj" },
      { key: "kreiraola", label: "Kreirao/la" },
      { key: "komentar", label: "Komentar" },
      { key: "grupa", label: "Grupa" },
      { key: "tip", label: "Tip" },
    ],
  },
] as const;

export interface MissingRequiredEntry {
  table: string;
  tableLabel: string;
  key: string;
  label: string;
  hint?: string;
  /** Polja iz nove baze (na toj tabeli) koja Super Admin može da izabere */
  candidateFields: Array<{ id: string; name: string }>;
}

/**
 * Računa nedostajuće obavezne ključeve na osnovu regenerisane mape.
 *
 * @param fields  Mapa { tableKey: { camelKey: fieldId } } iz regeneracije
 * @param rawTables  Sirov spisak tabela iz Airtable Metadata API-ja (po imenu)
 */
export function computeMissingRequired(params: {
  fields: Record<string, Record<string, string>>;
  rawTablesByCamelKey: Record<string, Array<{ id: string; name: string }>>;
}): MissingRequiredEntry[] {
  // Normalized indeksi (case-insensitive) jer regeneracija često spušta prvo slovo na mala
  const fieldsByLower: Record<string, { realKey: string; map: Record<string, string> }> = {};
  for (const [k, v] of Object.entries(params.fields)) {
    fieldsByLower[k.toLowerCase()] = { realKey: k, map: v };
  }
  const rawByLower: Record<string, Array<{ id: string; name: string }>> = {};
  for (const [k, v] of Object.entries(params.rawTablesByCamelKey)) {
    rawByLower[k.toLowerCase()] = v;
  }

  const missing: MissingRequiredEntry[] = [];
  for (const t of REQUIRED_SCHEMA) {
    const lowerT = t.table.toLowerCase();
    const tableEntry = params.fields[t.table] ? { map: params.fields[t.table] } : fieldsByLower[lowerT];
    const candidates = params.rawTablesByCamelKey[t.table] ?? rawByLower[lowerT] ?? [];

    if (!tableEntry) {
      for (const f of t.fields) {
        missing.push({
          table: t.table,
          tableLabel: t.label,
          key: f.key,
          label: f.label,
          hint: f.hint,
          candidateFields: candidates,
        });
      }
      continue;
    }

    // Indeks polja te tabele po lowercase ključu
    const fieldsLower: Record<string, string> = {};
    for (const [k, v] of Object.entries(tableEntry.map)) {
      fieldsLower[k.toLowerCase()] = v;
    }

    for (const f of t.fields) {
      const hit = tableEntry.map[f.key] ?? fieldsLower[f.key.toLowerCase()];
      if (!hit) {
        missing.push({
          table: t.table,
          tableLabel: t.label,
          key: f.key,
          label: f.label,
          hint: f.hint,
          candidateFields: candidates,
        });
      }
    }
  }
  return missing;
}

/* ============================================================ */
/* Obavezne Airtable automatizacije                              */
/* ============================================================ */

export interface RequiredAutomation {
  id: string;
  name: string;
  table: string;
  trigger: string;
  action: string;
  why: string;
}

/**
 * Automatizacije koje moraju postojati u Airtable bazi nakon remix-a, jer ih aplikacija
 * podrazumeva ali ih ne može sama instalirati preko Web API-ja.
 */
export const REQUIRED_AUTOMATIONS: ReadonlyArray<RequiredAutomation> = [
  {
    id: "promene-start-fallback",
    name: "PromeneNaloga: auto-popuna polja Start kad je prazno",
    table: "PromeneNaloga",
    trigger: "When a record is created (filter: pokretanje = true AND start is empty)",
    action: "Update record → postavi start = NOW()",
    why:
      "Operater može pokrenuti radni nalog bez izabranog vremena (polje „Start (opciono)” ostaje prazno). Bez ove automatizacije takvi zapisi nikad ne dobiju vreme početka.",
  },
  {
    id: "pomeri-start",
    name: "PromeneNaloga: „Pomeri start” pomera vremeOtvaranjaNaloga",
    table: "PromeneNaloga",
    trigger: "When a record is created (filter: pomeriStart = true)",
    action:
      "Update povezanog RadniNalozi.vremeOtvaranjaNaloga (npr. NOW() ili kraj poslednjeg zatvorenog segmenta).",
    why:
      "Akcija „Pomeri start” u aplikaciji samo upisuje pomeriStart=true. Override sloj nulira „Počeo” i čeka da ova automatizacija upiše novu vrednost — bez nje override ostaje do TTL-a.",
  },
  {
    id: "status-propagacija-monitoring",
    name: "Propagacija statusa naloga u Monitoring",
    table: "PromeneNaloga / Monitoring",
    trigger:
      "When a record matches conditions (pokretanje / pauziranje / reaktivacija / zatvaranje true)",
    action:
      "Update povezanog Monitoring reda: statusNaloga i statusMasine na novu vrednost (Pokrenut / Pauziran / Zatvoren).",
    why:
      "Override-i za start/pauza/stop se reconciluju tek kad Monitoring odrazi novi status. Bez ove automatizacije kartica vise na privremenoj vrednosti do TTL-a.",
  },
  {
    id: "link-nalog-na-liniju",
    name: "Start naloga: poveži RadniNalog sa Monitoring linijom",
    table: "RadniNalozi / Monitoring",
    trigger: "When a work order is started (statusNaloga = Pokrenut)",
    action: "Update Monitoring.radniNalog = link na pokrenuti nalog na toj proizvodnoj liniji.",
    why:
      "Start override (expected: brojNaloga) se reconciluje tek kad veza postoji — bez nje mašina ne pokazuje nalog.",
  },
  {
    id: "rollup-skart-dobro",
    name: "Rollup škarta i dobro proizvedeno",
    table: "RadniNalozi / Monitoring",
    trigger: "When a PromeneNaloga record with kolicinaSkarta or dobroProizvedeno is created/updated",
    action:
      "Rollup/summary na RadniNalozi.skart i RadniNalozi.ispravnoProizvedeno (i propagacija u Monitoring).",
    why:
      "Škart override (skartGte) se reconciluje kad rollup sustigne. Bez nje brojač škarta na kartici se ne osvežava.",
  },
  {
    id: "grupa-tip-zastoja",
    name: "Propagacija grupe/tipa zastoja u Monitoring",
    table: "Zastoji / Monitoring",
    trigger: "When a Zastoj is created/updated with grupa & tip",
    action: "Update Monitoring.grupa i Monitoring.tip (lookup ili copy iz aktivnog zastoja).",
    why:
      "Override za definisanje zastoja postavlja grupu/tip privremeno i čeka ovu automatizaciju da ih trajno upiše.",
  },
  {
    id: "stop-raskid-veze",
    name: "Stop naloga: raskini Monitoring.radniNalog",
    table: "RadniNalozi / Monitoring",
    trigger: "When a work order is closed (statusNaloga = Zatvoren)",
    action: "Update Monitoring.radniNalog = prazno (ukloni link).",
    why:
      "Stop override (expected: brojNaloga prazno) se reconciluje kad veza nestane — bez nje kartica i dalje pokazuje stari nalog.",
  },
] as const;


/* ============================================================ */
/* Opciona polja — degradiraju graccijalno (prikaz „—”)         */
/* ============================================================ */

export interface OptionalField {
  table: string;
  key: string;
  label: string;
  hint: string;
}

/**
 * Polja koja aplikacija koristi za prikaz ali ne zahteva. Ako nisu mapirana,
 * UI prikazuje „—". Navedeno samo radi dokumentacije u remix vodiču.
 */
export const OPTIONAL_FIELDS: ReadonlyArray<OptionalField> = [
  { table: "RadniNalozi", key: "performanseFinal", label: "Performanse (final)", hint: "OEE/performanse prikaz" },
  { table: "RadniNalozi", key: "procenjenoTrajanjeDhmin", label: "Procenjeno trajanje", hint: "Procena na osnovu mase/brzine" },
  { table: "RadniNalozi", key: "masaKomadaG", label: "Masa komada (g/kg)", hint: "Naziv varira (g vs kg)" },
  { table: "RadniNalozi", key: "alatLookup", label: "Alat (lookup)", hint: "Prikaz alata na nalogu" },
] as const;
