
## Cilj
Prikazati polje **Prioritet** radnog naloga (`fldSHYcMuDNzy6tef`) kao obojeni badge na 4 mesta:
1. Aktivan radni nalog na **Shop Floor** kartici
2. Aktivan radni nalog na **Monitoring** kartici mašine
3. Lista "Dostupni radni nalozi" → tab "Pokretanje" u **Shop Floor**
4. Dijalog "Pokreni radni nalog" u **Monitoring** tabu

## Boje (iz Airtable)
- **Visok** → `orangeBright` (narandžasta, jako)
- **Normalan** → `greenLight1` (svetlo zelena)
- **Nizak** → `blueLight2` (svetlo plava)

## Položaj (kako stoji u prilozima)
Odmah pored broja radnog naloga na desktopu, ili u novom redu ispod broja na mobilnom (`inline-flex` badge sa `flex-wrap`).

## Tehničke izmene

### 1. Backend — propagiraj `prioritet`
Polje već postoji u schemi (`RadniNalozi.prioritet`). Treba ga dodati u DTO-ove i mapere:

- **`src/lib/api/dashboard.functions.ts`**
  - `MachineDashboardRow`: dodaj `prioritet?: string`
  - U `machines.map(...)` postavi `prioritet: pickStr(wo?.prioritet)`

- **`src/lib/api/workorder.functions.ts`**
  - `AvailableWorkOrder` interface: dodaj `prioritet?: string`
  - U `getAvailableWorkOrdersFn` u `items` mapiranju: `prioritet: typeof r.prioritet === "string" ? r.prioritet : undefined`

### 2. Frontend — komponenta `PriorityBadge`
Nova fajl: **`src/components/work-order/PriorityBadge.tsx`**

```tsx
const COLORS: Record<string, string> = {
  "Visok":    "bg-orange-500 text-white",
  "Normalan": "bg-green-200 text-green-900",
  "Nizak":    "bg-blue-200 text-blue-900",
};
export function PriorityBadge({ value, className }: { value?: string; className?: string }) {
  if (!value) return null;
  const cls = COLORS[value] ?? "bg-muted text-foreground";
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
      cls, className,
    )}>
      {value}
    </span>
  );
}
```

### 3. Mesta upotrebe

- **`src/routes/_auth/monitoring.tsx`** (~ red 657): pored `{m.brojNaloga}` ubaci `<PriorityBadge value={m.prioritet} />` u istom flex redu sa `flex-wrap gap-2`.
- **`src/routes/_auth/shop-floor.tsx`**:
  - Aktivan WO kartica (~ red 345): pored `{m.brojNaloga}`.
  - "Dostupni nalozi" lista (~ red 1204): pored `{wo.brojNaloga}` u istom redu sa `Potvrđen` badge-om.
- **`src/components/work-order/StartWorkOrderDialog.tsx`** (~ red gde se renderuje stavka liste sa `brojNaloga` i `Potvrđen` badge-om): pored broja naloga.

## Out of scope
- Bez izmena Airtable polja, bez filtriranja/sortiranja po prioritetu, bez izmene istorije/inspekcije.
