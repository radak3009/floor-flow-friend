import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { getHistoryFn, type HistoryResult } from "@/lib/api/history.functions";
import { getDashboardFn } from "@/lib/api/dashboard.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Clipboard, Boxes, ShieldAlert, Clock, AlertTriangle } from "lucide-react";
import WorkOrderDetailsDialog from "@/components/work-order/WorkOrderDetailsDialog";
import type { MachineDashboardRow } from "@/lib/api/dashboard.functions";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/_auth/istorija")({
  head: () => ({ meta: [{ title: "Istorija — MES Shop Floor" }] }),
  component: IstorijaPage,
});

type TabId = "rn" | "zastoji" | "skart" | "inspekcija";

const TAB_IDS: TabId[] = ["rn", "zastoji", "skart", "inspekcija"];

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromDateInput(s: string, end = false): string {
  const d = new Date(s + (end ? "T23:59:59" : "T00:00:00"));
  return d.toISOString();
}
function fmtDateTime(s?: string): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return `${d.toLocaleDateString("sr-RS")} ${d.toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit" })}`;
  } catch { return s; }
}
function fmtDuration(min: number): string {
  if (!min) return "0min";
  const d = Math.floor(min / (24 * 60));
  const h = Math.floor((min % (24 * 60)) / 60);
  const m = min % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}min`);
  return parts.join(" ");
}

function KpiCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "primary" | "success" | "warning" | "danger" }) {
  const toneBg = {
    primary: "bg-primary/10 text-primary",
    success: "bg-emerald-500/10 text-emerald-600",
    warning: "bg-amber-500/10 text-amber-600",
    danger: "bg-rose-500/10 text-rose-600",
  }[tone ?? "primary"];
  return (
    <div className="rounded-lg border border-border p-4 bg-card flex items-start gap-3">
      <div className={`size-10 rounded-md grid place-items-center ${toneBg}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function statusBadge(s?: string) {
  if (!s) return <span className="text-muted-foreground">—</span>;
  const lower = s.toLowerCase();
  let cls = "bg-secondary text-secondary-foreground";
  if (lower.includes("rad") || lower === "u toku") cls = "bg-emerald-500/15 text-emerald-700";
  else if (lower.includes("pauz")) cls = "bg-amber-500/15 text-amber-700";
  else if (lower.includes("zavr") || lower.includes("arhiv")) cls = "bg-muted text-muted-foreground";
  else if (lower.includes("zast")) cls = "bg-rose-500/15 text-rose-700";
  return <span className={`inline-flex items-center px-2 h-6 rounded-full text-xs font-medium ${cls}`}>{s}</span>;
}

function qualityBadge(s?: string, kind: "general" | "ok" = "general") {
  if (!s) return <span className="text-muted-foreground">—</span>;
  const v = s.toLowerCase();
  let cls = "bg-secondary text-secondary-foreground";
  if (kind === "ok") {
    cls = v === "ok" ? "bg-emerald-500/15 text-emerald-700" : "bg-rose-500/15 text-rose-700";
  } else if (v.startsWith("dobr")) cls = "bg-emerald-500/15 text-emerald-700";
  else if (v.startsWith("zadovol")) cls = "bg-sky-500/15 text-sky-700";
  else if (v.startsWith("nezadovol")) cls = "bg-amber-500/15 text-amber-700";
  else if (v.startsWith("nepr")) cls = "bg-rose-500/15 text-rose-700";
  return <span className={`inline-flex items-center px-2 h-6 rounded-full text-xs font-medium ${cls}`}>{s}</span>;
}

function ColSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      placeholder="Pretraži…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-8 px-2 text-xs rounded border border-input bg-background"
    />
  );
}

function IstorijaPage() {
  const { t, i18n } = useTranslation();
  const lang: "sr" | "en" = i18n.language?.startsWith("en") ? "en" : "sr";
  const today = new Date();
  const sevenAgo = new Date(today);
  sevenAgo.setDate(today.getDate() - 6);

  const [from, setFrom] = useState<string>(toDateInput(sevenAgo));
  const [to, setTo] = useState<string>(toDateInput(today));
  const [resursId, setResursId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [tab, setTab] = useState<TabId>("rn");
  const [colSearch, setColSearch] = useState<Record<string, string>>({});
  const [detailsM, setDetailsM] = useState<MachineDashboardRow | null>(null);

  const { user } = useAuth();
  const getHistory = useServerFn(getHistoryFn);
  const getDashboard = useServerFn(getDashboardFn);

  const { data, isLoading, error } = useQuery({
    queryKey: ["history", from, to, resursId, status, lang],
    queryFn: () => getHistory({ data: { from: fromDateInput(from), to: fromDateInput(to, true), resursId: resursId || undefined, status: status || undefined, lang } }) as Promise<HistoryResult>,
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const { data: dashData } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(),
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const machines = useMemo(() => {
    const list = (dashData?.machines ?? []).filter((m) => m.resursiId);
    const seen = new Set<string>();
    return list.filter((m) => {
      if (seen.has(m.resursiId!)) return false;
      seen.add(m.resursiId!);
      return true;
    });
  }, [dashData]);

  const setPreset = (days: number) => {
    const t = new Date();
    const f = new Date();
    f.setDate(t.getDate() - (days - 1));
    setFrom(toDateInput(f));
    setTo(toDateInput(t));
  };

  // Client-side column search filter
  const filterRows = <T extends Record<string, any>>(rows: T[], fields: (keyof T)[]): T[] => {
    return rows.filter((r) =>
      fields.every((f) => {
        const q = (colSearch[`${tab}.${String(f)}`] || "").trim().toLowerCase();
        if (!q) return true;
        const v = r[f];
        return v != null && String(v).toLowerCase().includes(q);
      })
    );
  };

  const counts = {
    rn: data?.radniNalozi.length ?? 0,
    zastoji: data?.zastoji.length ?? 0,
    skart: data?.skart.length ?? 0,
    inspekcija: data?.inspekcije.length ?? 0,
  };
  const currentFilterLabel = t("istorija.filterLabel");

  const openRnDetails = (row: { id: string; brojNaloga?: string; masina?: string; sifraArtikla?: string; artikalNaziv?: string; narucilac?: string; planiranaKolicina?: number; ispravnoProizvedeno?: number; skart?: number; statusNaloga?: string }) => {
    setDetailsM({
      monitoringId: "",
      nazivLinije: row.masina ?? "—",
      statusMasine: "",
      radniNalogId: row.id,
      brojNaloga: row.brojNaloga,
      sifraArtikla: row.sifraArtikla,
      artikalNaziv: row.artikalNaziv,
      narucilac: row.narucilac,
      planiranaKolicina: row.planiranaKolicina,
      ispravnoProizvedeno: row.ispravnoProizvedeno,
      skart: row.skart,
      statusNaloga: row.statusNaloga,
      hasAvailableOrders: false,
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="hidden lg:block text-xl font-semibold uppercase tracking-wide">{t("istorija.title")}</h1>
        <div className="text-xs text-muted-foreground ml-auto">
          {t("common.search")}: <span className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground font-medium">{currentFilterLabel}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border bg-card p-3 md:p-4 mb-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground w-8">{t("istorija.from")}</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground w-8">{t("istorija.to")}</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => { const td = new Date(); setFrom(toDateInput(td)); setTo(toDateInput(td)); }}>{t("istorija.preset.today", { defaultValue: "Danas" })}</Button>
          <Button size="sm" variant="outline" onClick={() => setPreset(7)}>{t("istorija.preset.7d", { defaultValue: "7 dana" })}</Button>
          <Button size="sm" variant="outline" onClick={() => setPreset(30)}>{t("istorija.preset.30d", { defaultValue: "30 dana" })}</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select value={resursId || "__all"} onValueChange={(v) => setResursId(v === "__all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder={t("istorija.allMachines")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("istorija.allMachines")}</SelectItem>
              {machines.map((m) => (
                <SelectItem key={m.resursiId} value={m.resursiId!}>{m.nazivLinije}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status || "__all"} onValueChange={(v) => setStatus(v === "__all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Svi statusi" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Svi statusi</SelectItem>
              <SelectItem value="U toku">U toku</SelectItem>
              <SelectItem value="Pauziran">Pauziran</SelectItem>
              <SelectItem value="Potvrđen">Potvrđen</SelectItem>
              <SelectItem value="Završen">Završen</SelectItem>
              <SelectItem value="Arhiviran">Arhiviran</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 mb-4">
        {isLoading ? (
          <>
            <Skeleton className="h-20" /><Skeleton className="h-20" />
            <Skeleton className="h-20" /><Skeleton className="h-20" />
          </>
        ) : (
          <>
            <KpiCard icon={<Clipboard className="size-5" />} label="Radni nalozi" value={String(data?.kpis.radniNalozi ?? 0)} tone="primary" />
            <KpiCard icon={<Boxes className="size-5" />} label="Ukupno proiz." value={`${data?.kpis.ukupnoProiz ?? 0} kom`} tone="success" />
            <KpiCard icon={<ShieldAlert className="size-5" />} label="Ukupno škarta" value={`${data?.kpis.ukupnoSkart ?? 0} kom`} tone="warning" />
            <KpiCard icon={<Clock className="size-5" />} label="Zastoji ukupno" value={fmtDuration(data?.kpis.zastojiTotalMin ?? 0)} sub={`${data?.kpis.zastojiCount ?? 0} događaja`} tone="danger" />
          </>
        )}
      </div>


      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 text-destructive px-3 py-2 text-sm mb-3">
          Greška pri učitavanju istorije: {(error as Error).message}
        </div>
      )}

      {/* Tabs */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-start md:justify-center gap-1 px-2 md:px-3 py-2 border-b border-border bg-muted/40 overflow-x-auto">
          {TAB_IDS.map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 h-8 rounded-md text-sm flex items-center gap-2 shrink-0 ${tab === id ? "bg-background border border-border font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t(`istorija.tabs.${id}`)}
              <Badge variant="secondary" className="text-xs">{counts[id]}</Badge>
            </button>
          ))}
        </div>


        {data?.truncated[tab === "rn" ? "radniNalozi" : tab === "inspekcija" ? "inspekcije" : tab] && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-200">
            <AlertTriangle className="size-3.5" /> Prikazano je prvih 100 zapisa. Suzite opseg datuma ili filtere.
          </div>
        )}

        <div className="overflow-x-auto">
          {tab === "rn" && (
            <RnTable rows={filterRows(data?.radniNalozi ?? [], ["datum", "brojNaloga", "masina", "artikalNaziv", "narucilac", "statusNaloga"])} isLoading={isLoading} tab={tab} colSearch={colSearch} setColSearch={setColSearch} onOpen={openRnDetails} />
          )}
          {tab === "zastoji" && (
            <ZastojiTable rows={filterRows(data?.zastoji ?? [], ["idZapisa", "masina", "grupa", "tip", "brojNaloga"])} isLoading={isLoading} tab={tab} colSearch={colSearch} setColSearch={setColSearch} />
          )}
          {tab === "skart" && (
            <SkartTable rows={filterRows(data?.skart ?? [], ["brojNaloga", "masina", "artikalNaziv", "kategorija", "operator"])} isLoading={isLoading} tab={tab} colSearch={colSearch} setColSearch={setColSearch} />
          )}
          {tab === "inspekcija" && (
            <InspekcijaTable rows={filterRows(data?.inspekcije ?? [], ["brojNaloga", "masina", "operator"])} isLoading={isLoading} tab={tab} colSearch={colSearch} setColSearch={setColSearch} />
          )}
        </div>
      </div>

      <WorkOrderDetailsDialog open={!!detailsM} onOpenChange={(v) => !v && setDetailsM(null)} m={detailsM} />
    </div>
  );
}

// ---------- Tables ----------

function TableShell({ children }: { children: React.ReactNode }) {
  return <table className="w-full text-sm">{children}</table>;
}
function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`text-left font-medium text-muted-foreground px-3 py-2 ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-middle ${className}`}>{children}</td>;
}
function EmptyRow({ cols, text = "Nema podataka" }: { cols: number; text?: string }) {
  return (
    <tr><td colSpan={cols} className="px-3 py-10 text-center text-muted-foreground">{text}</td></tr>
  );
}

type TableSearchProps = {
  tab: string;
  colSearch: Record<string, string>;
  setColSearch: React.Dispatch<React.SetStateAction<Record<string, string>>>;
};

function ColSearchCell({
  field,
  tab,
  colSearch,
  setColSearch,
}: {
  field: string;
} & TableSearchProps) {
  const key = `${tab}.${field}`;
  return (
    <ColSearch
      value={colSearch[key] || ""}
      onChange={(v) => setColSearch((p) => ({ ...p, [key]: v }))}
    />
  );
}

function RnTable({
  rows,
  isLoading,
  tab,
  colSearch,
  setColSearch,
  onOpen,
}: {
  rows: any[];
  isLoading: boolean;
  onOpen: (r: any) => void;
} & TableSearchProps) {
  const s = { tab, colSearch, setColSearch };
  return (
    <TableShell>
      <thead className="bg-muted/30">
        <tr>
          <Th>Datum</Th><Th>Radni nalog</Th><Th>Mašina</Th><Th>Artikal</Th><Th>Narucilac</Th>
          <Th className="text-right">Plan</Th><Th className="text-right">Proizv.</Th><Th className="text-right">Škart</Th>
          <Th className="text-right">Realiz.</Th><Th className="text-right">Perf.</Th>
          <Th>Trajanje</Th><Th>Status</Th>
        </tr>
        <tr>
          <Td></Td>
          <Td><ColSearchCell field="brojNaloga" {...s} /></Td>
          <Td><ColSearchCell field="masina" {...s} /></Td>
          <Td><ColSearchCell field="artikalNaziv" {...s} /></Td>
          <Td><ColSearchCell field="narucilac" {...s} /></Td>
          <Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td>
          <Td><ColSearchCell field="statusNaloga" {...s} /></Td>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {isLoading && <tr><td colSpan={12} className="px-3 py-10"><Skeleton className="h-6" /></td></tr>}
        {!isLoading && rows.length === 0 && <EmptyRow cols={12} />}
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-muted/40">
            <Td className="text-muted-foreground whitespace-nowrap">{fmtDateTime(r.datum)}</Td>
            <Td>
              <button onClick={() => onOpen(r)} className="font-medium text-primary hover:underline">{r.brojNaloga || "—"}</button>
            </Td>
            <Td>{r.masina || "—"}</Td>
            <Td className="max-w-[280px] truncate">{[r.sifraArtikla, r.artikalNaziv].filter(Boolean).join(" · ") || "—"}</Td>
            <Td>{r.narucilac || "—"}</Td>
            <Td className="text-right tabular-nums">{r.planiranaKolicina ?? "—"}</Td>
            <Td className="text-right tabular-nums">{r.ispravnoProizvedeno ?? "—"}</Td>
            <Td className="text-right tabular-nums text-amber-600">{r.skart ?? 0}</Td>
            <Td className="text-right tabular-nums">{r.realizovano != null ? `${Math.round((r.realizovano || 0) * 100)}%` : "—"}</Td>
            <Td className="text-right tabular-nums">{r.performanse != null ? `${Math.round((r.performanse || 0) * 100)}%` : "—"}</Td>
            <Td className="whitespace-nowrap text-muted-foreground">{r.ukupnoTrajanjeNaloga || "—"}</Td>
            <Td>{statusBadge(r.statusNaloga)}</Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function ZastojiTable({
  rows,
  isLoading,
  tab,
  colSearch,
  setColSearch,
}: {
  rows: any[];
  isLoading: boolean;
} & TableSearchProps) {
  const s = { tab, colSearch, setColSearch };
  return (
    <TableShell>
      <thead className="bg-muted/30">
        <tr>
          <Th>ID zapisa</Th><Th>Mašina</Th><Th>Start</Th><Th>Kraj</Th>
          <Th>Grupa</Th><Th>Tip</Th><Th className="text-right">Trajanje</Th><Th>Radni nalog</Th><Th>Komentar</Th>
        </tr>
        <tr>
          <Td><ColSearchCell field="idZapisa" {...s} /></Td>
          <Td><ColSearchCell field="masina" {...s} /></Td>
          <Td></Td><Td></Td>
          <Td><ColSearchCell field="grupa" {...s} /></Td>
          <Td><ColSearchCell field="tip" {...s} /></Td>
          <Td></Td>
          <Td><ColSearchCell field="brojNaloga" {...s} /></Td>
          <Td></Td>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {isLoading && <tr><td colSpan={9} className="px-3 py-10"><Skeleton className="h-6" /></td></tr>}
        {!isLoading && rows.length === 0 && <EmptyRow cols={9} />}
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-muted/40">
            <Td className="text-muted-foreground tabular-nums">{r.idZapisa || "—"}</Td>
            <Td>{r.masina || "—"}</Td>
            <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.start)}</Td>
            <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.kraj)}</Td>
            <Td>{r.grupa ? <Badge variant="secondary">{r.grupa}</Badge> : "—"}</Td>
            <Td>{r.tip || "—"}</Td>
            <Td className="text-right text-rose-600 whitespace-nowrap">{r.trajanjeZastoja || "—"}</Td>
            <Td>{r.brojNaloga || "—"}</Td>
            <Td className="max-w-[260px] truncate text-muted-foreground">{r.komentar || "—"}</Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function SkartTable({
  rows,
  isLoading,
  tab,
  colSearch,
  setColSearch,
}: {
  rows: any[];
  isLoading: boolean;
} & TableSearchProps) {
  const s = { tab, colSearch, setColSearch };
  return (
    <TableShell>
      <thead className="bg-muted/30">
        <tr>
          <Th>Datum i vreme</Th><Th>Radni nalog</Th><Th>Mašina</Th><Th>Artikal</Th><Th>Kategorija</Th>
          <Th className="text-right">Količina</Th><Th>Operater</Th>
        </tr>
        <tr>
          <Td></Td>
          <Td><ColSearchCell field="brojNaloga" {...s} /></Td>
          <Td><ColSearchCell field="masina" {...s} /></Td>
          <Td><ColSearchCell field="artikalNaziv" {...s} /></Td>
          <Td><ColSearchCell field="kategorija" {...s} /></Td>
          <Td></Td>
          <Td><ColSearchCell field="operator" {...s} /></Td>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {isLoading && <tr><td colSpan={7} className="px-3 py-10"><Skeleton className="h-6" /></td></tr>}
        {!isLoading && rows.length === 0 && <EmptyRow cols={7} />}
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-muted/40">
            <Td className="text-muted-foreground whitespace-nowrap">{fmtDateTime(r.datum)}</Td>
            <Td>{r.brojNaloga || "—"}</Td>
            <Td>{r.masina || "—"}</Td>
            <Td>{r.artikalNaziv || "—"}</Td>
            <Td>{r.kategorija ? <Badge variant="secondary">{r.kategorija}</Badge> : "—"}</Td>
            <Td className="text-right tabular-nums text-amber-600">{r.kolicina ?? 0}</Td>
            <Td>{r.operator || "—"}</Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function InspekcijaTable({
  rows,
  isLoading,
  tab,
  colSearch,
  setColSearch,
}: {
  rows: any[];
  isLoading: boolean;
} & TableSearchProps) {
  const s = { tab, colSearch, setColSearch };
  return (
    <TableShell>
      <thead className="bg-muted/30">
        <tr>
          <Th>Datum i vreme</Th><Th>Radni nalog</Th><Th>Mašina</Th>
          <Th>Vizuelno</Th><Th>Funkcionalno</Th><Th>Int. kvalitet</Th><Th>Ocena</Th>
          <Th>Komentar</Th><Th>Kreirao</Th>
        </tr>
        <tr>
          <Td></Td>
          <Td><ColSearchCell field="brojNaloga" {...s} /></Td>
          <Td><ColSearchCell field="masina" {...s} /></Td>
          <Td></Td><Td></Td><Td></Td><Td></Td><Td></Td>
          <Td><ColSearchCell field="operator" {...s} /></Td>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {isLoading && <tr><td colSpan={9} className="px-3 py-10"><Skeleton className="h-6" /></td></tr>}
        {!isLoading && rows.length === 0 && <EmptyRow cols={9} />}
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-muted/40">
            <Td className="text-muted-foreground whitespace-nowrap">{fmtDateTime(r.datum)}</Td>
            <Td>{r.brojNaloga || "—"}</Td>
            <Td>{r.masina || "—"}</Td>
            <Td>{qualityBadge(r.vizuelno)}</Td>
            <Td>{qualityBadge(r.funkcionalno)}</Td>
            <Td>{qualityBadge(r.integralniKvalitet)}</Td>
            <Td>{qualityBadge(r.ukupnaOcena, "ok")}</Td>
            <Td className="max-w-[220px] truncate text-muted-foreground">{r.komentar || "—"}</Td>
            <Td>{r.operator || "—"}</Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}
