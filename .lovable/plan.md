# Monitoring kartice — uvek prikazani detalji + novo polje "Preostalo materijala (kg)"

## 1) Uvek prikaži detalje na dnu kartice
Fajl: `src/routes/_auth/monitoring.tsx`

- Ukloniti dugme za toggle (linije ~703–709: `<button onClick={onToggle}>` sa `ChevronUp/ChevronDown` i tekstom `monitoring.hideDetails/showDetails`).
- Ukloniti uslov `expanded && (...)` (linije ~711, ~724) i uvek renderovati grid sa `Stat` elementima.
- Skloniti sada nekorišćene propse/stanja: `expanded`, `onToggle` iz `MachineCard` props (linije ~484–488), kao i `expanded={!!expanded[m.monitoringId]}` na pozivnoj strani (~315) i `useState` `expanded` (~86) plus handler koji ga setuje (ako postoji `setExpanded`). Iz `lucide-react` import (~19) skloniti `ChevronDown, ChevronUp` ako više nisu korišćeni.
- (Opciono čišćenje) ukloniti iz `src/lib/i18n/locales/{sr,en}.json` ključeve `monitoring.showDetails` i `monitoring.hideDetails` ako se ne koriste nigde drugde — proveriti `rg` pre brisanja.

## 2) Dodati polje "Preostalo materijala (kg)"
Airtable field id: `fldIOApeVYDbuh9HI` na tabeli `RadniNalozi`.

### a) Schema
Fajl: `src/lib/airtable/schema.ts` — u blok `"RadniNalozi": { ... }` dodati:
```
"preostaloMaterijalaKg": "fldIOApeVYDbuh9HI",
```

### b) Required schema (panel "Podešavanja → Airtable mapiranje")
Fajl: `src/lib/airtable/required-schema.ts` — u listu polja `RadniNalozi` (oko linije 95–107) dodati:
```
{ key: "preostaloMaterijalaKg", label: "Preostalo materijala (kg)" },
```

### c) Dashboard server fn
Fajl: `src/lib/api/dashboard.functions.ts`
- U `MachineDashboardRow` interface dodati: `preostaloMaterijalaKg?: number;`
- U mapiranje `machines = monResult.records.map((m) => { ... })` dodati:
```
preostaloMaterijalaKg: pickNum((wo as any)?.preostaloMaterijalaKg),
```
(koristi postojeći `pickNum` helper; `wo` već nosi sva polja iz `RadniNalozi.findAll`.)

### d) UI — novi Stat u detaljima
Fajl: `src/routes/_auth/monitoring.tsx`, u grid detalja (sada uvek vidljiv) dodati novi `Stat` posle "Preostalo (kom)":
```
<Stat
  label={t("monitoring.remainingMaterialKg")}
  value={`${formatNumber(m.preostaloMaterijalaKg ?? 0)} kg`}
/>
```
Promeniti grid na `md:grid-cols-7` (ili ostaviti `md:grid-cols-6` — 7 polja će se wrap-ovati u dva reda; preporuka: `md:grid-cols-7` za jedan red na desktopu).

### e) Prevodi
Fajlovi: `src/lib/i18n/locales/sr.json`, `src/lib/i18n/locales/en.json`
- `monitoring.remainingMaterialKg`: SR `"Preostalo materijala (kg)"`, EN `"Remaining material (kg)"`.

## Verifikacija
- Build prolazi (vitest + tsc).
- Na `/monitoring` kartice odmah pokazuju detalje bez klika.
- Novo polje pokazuje vrednost iz `RadniNalozi.preostaloMaterijalaKg` kada postoji aktivan WO, inače `0 kg`.
