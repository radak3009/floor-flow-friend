import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ShieldAlert, CheckCircle2, AlertTriangle, XCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import {
  getFieldMappingOverviewFn,
  saveManualFieldOverridesFn,
  type FieldMappingEntry,
} from "@/lib/airtable/config.functions";

export const Route = createFileRoute("/_auth/podesavanja/airtable/mapiranje")({
  head: () => ({ meta: [{ title: "Mapiranje polja — Airtable" }] }),
  component: FieldMappingPage,
});

function isSuperAdmin(roleName: string | undefined): boolean {
  return (roleName ?? "").trim().toLowerCase() === "super admin";
}

function FieldMappingPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const getOverview = useServerFn(getFieldMappingOverviewFn);
  const saveOverrides = useServerFn(saveManualFieldOverridesFn);
  const isSuper = isSuperAdmin(user?.roleName);

  const overviewQ = useQuery({
    queryKey: ["airtable-mapping-overview", user?.id],
    enabled: !!user?.id && isSuper,
    queryFn: () => getOverview({ data: { currentUserId: user!.id } }),
  });

  // picks: pending izmene koje korisnik treba da snimi. key = `${table}::${camelKey}` -> fieldId
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [showOnlyDiff, setShowOnlyDiff] = useState(false);

  useEffect(() => {
    setPicks({});
  }, [overviewQ.data]);

  const saveM = useMutation({
    mutationFn: async () => {
      const overrides = Object.entries(picks)
        .filter(([, v]) => !!v)
        .map(([k, v]) => {
          const [table, key] = k.split("::");
          return { table, key, fieldId: v };
        });
      if (overrides.length === 0) throw new Error("Nema izmena za snimanje.");
      return saveOverrides({ data: { currentUserId: user!.id, overrides } });
    },
    onSuccess: (res) => {
      toast.success(`Sačuvano: ${res.appliedCount} izmena. Nedostaje obaveznih: ${res.missingRequired.length}.`);
      setPicks({});
      qc.invalidateQueries({ queryKey: ["airtable-mapping-overview"] });
      qc.invalidateQueries({ queryKey: ["airtable-config-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Greška pri snimanju"),
  });

  const allEntries: FieldMappingEntry[] = useMemo(() => {
    if (!overviewQ.data) return [];
    return [...overviewQ.data.required, ...overviewQ.data.optional];
  }, [overviewQ.data]);

  const filteredByTable = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = allEntries.filter((e) => {
      if (showOnlyDiff && e.status === "mapped" && !picks[`${e.table}::${e.key}`]) return false;
      if (!q) return true;
      return (
        e.expectedLabel.toLowerCase().includes(q) ||
        e.key.toLowerCase().includes(q) ||
        (e.currentFieldName ?? "").toLowerCase().includes(q) ||
        e.table.toLowerCase().includes(q)
      );
    });
    const groups = new Map<string, FieldMappingEntry[]>();
    for (const e of filtered) {
      const k = e.isOptional ? `Opciono: ${e.tableLabel}` : e.tableLabel;
      const arr = groups.get(k) ?? [];
      arr.push(e);
      groups.set(k, arr);
    }
    return [...groups.entries()];
  }, [allEntries, filter, showOnlyDiff, picks]);

  const stats = useMemo(() => {
    let mapped = 0, missing = 0, stale = 0;
    for (const e of overviewQ.data?.required ?? []) {
      if (e.status === "mapped") mapped++;
      else if (e.status === "missing") missing++;
      else stale++;
    }
    return { mapped, missing, stale, pending: Object.values(picks).filter(Boolean).length };
  }, [overviewQ.data, picks]);

  if (!user) return null;
  if (!isSuper) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 flex items-start gap-3">
          <ShieldAlert className="size-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Pristup zabranjen</div>
            <div className="text-sm text-muted-foreground mt-1">
              Samo Super Admin može da menja mapiranje polja.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link
          to="/podesavanja/airtable"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronLeft className="size-4" /> Airtable konfiguracija
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold uppercase tracking-wide">Mapiranje polja</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pregled „pre / posle": leva kolona je naziv koji aplikacija očekuje (iz koda), desna je
          aktuelno polje u Airtable bazi na koje je mapirano. Ako se nazivi razlikuju (npr.
          „Masa komada (kg)" vs „Masa komad (g)") — ovde to ručno potvrđuješ izborom.
        </p>
      </div>

      {/* Status pills */}
      <div className="flex flex-wrap gap-2">
        <Pill icon={<CheckCircle2 className="size-3.5" />} label="Mapirano" count={stats.mapped} tone="ok" />
        <Pill icon={<XCircle className="size-3.5" />} label="Nedostaje" count={stats.missing} tone="err" />
        <Pill icon={<AlertTriangle className="size-3.5" />} label="Zastarelo" count={stats.stale} tone="warn" />
        {stats.pending > 0 && (
          <Pill icon={<span className="text-[10px]">●</span>} label="Pending izmena" count={stats.pending} tone="info" />
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <div className="relative flex-1">
          <Search className="size-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Pretraži po ključu, labeli ili nazivu polja…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8"
          />
        </div>
        <label className="text-sm inline-flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showOnlyDiff}
            onChange={(e) => setShowOnlyDiff(e.target.checked)}
            className="size-4"
          />
          Sakrij OK redove (prikaži samo razlike / pending)
        </label>
        <Button
          onClick={() => saveM.mutate()}
          disabled={saveM.isPending || stats.pending === 0}
        >
          {saveM.isPending ? "Snimam…" : `Sačuvaj ${stats.pending} izmen${stats.pending === 1 ? "u" : "a"}`}
        </Button>
      </div>

      {overviewQ.isLoading && (
        <div className="text-sm text-muted-foreground">Učitavanje…</div>
      )}

      {overviewQ.data && !overviewQ.data.hasOverride && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm">
          Nema aktivne Airtable override konfiguracije. Otvori{" "}
          <Link to="/podesavanja/airtable" className="underline">Airtable konfiguraciju</Link>{" "}
          i prvo regeneriši mapu.
        </div>
      )}

      {overviewQ.data?.hasOverride && filteredByTable.length === 0 && (
        <div className="text-sm text-muted-foreground italic">Nema redova koji odgovaraju filteru.</div>
      )}

      <div className="space-y-6">
        {filteredByTable.map(([groupLabel, items]) => (
          <section key={groupLabel} className="rounded-xl border border-border bg-card overflow-hidden">
            <header className="px-4 py-2.5 bg-muted/40 border-b border-border text-sm font-semibold">
              {groupLabel}
            </header>
            <div className="divide-y divide-border">
              {/* Header row (desktop) */}
              <div className="hidden md:grid grid-cols-[1.2fr_1fr_1.4fr_auto] gap-3 px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                <div>Očekivano (aplikacija)</div>
                <div>Trenutno (Airtable)</div>
                <div>Ručna promena</div>
                <div className="text-right">Status</div>
              </div>
              {items.map((e) => {
                const pickKey = `${e.table}::${e.key}`;
                const pending = picks[pickKey];
                return (
                  <div
                    key={pickKey}
                    className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1.4fr_auto] gap-3 px-4 py-3 items-center"
                  >
                    <div>
                      <div className="font-medium text-sm">
                        {e.expectedLabel}
                        {e.isOptional && (
                          <span className="ml-2 text-[10px] uppercase text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            opciono
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{e.key}</div>
                      {e.hint && <div className="text-xs text-muted-foreground mt-0.5">{e.hint}</div>}
                    </div>
                    <div className="text-sm">
                      {e.status === "mapped" && e.currentFieldName ? (
                        <div>
                          <div className="font-medium">{e.currentFieldName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{e.currentFieldId}</div>
                        </div>
                      ) : e.status === "stale" ? (
                        <div className="text-amber-600 dark:text-amber-400 text-xs">
                          ⚠ ID <code>{e.currentFieldId}</code> ne postoji u bazi
                        </div>
                      ) : (
                        <div className="text-muted-foreground italic text-xs">— nije mapirano —</div>
                      )}
                    </div>
                    <div>
                      <Select
                        value={pending ?? ""}
                        onValueChange={(v) => setPicks((p) => ({ ...p, [pickKey]: v }))}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              e.candidates.length === 0
                                ? "Tabela ne postoji u bazi"
                                : "— Izaberi polje za promenu —"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {e.candidates.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                              <span className="ml-2 text-[10px] text-muted-foreground">{c.id}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {pending && (
                        <button
                          type="button"
                          onClick={() =>
                            setPicks((p) => {
                              const n = { ...p };
                              delete n[pickKey];
                              return n;
                            })
                          }
                          className="text-xs text-muted-foreground hover:text-foreground mt-1 underline"
                        >
                          Otkaži izmenu
                        </button>
                      )}
                    </div>
                    <div className="text-right">
                      <StatusBadge status={e.status} pending={!!pending} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Pill({
  icon,
  label,
  count,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  tone: "ok" | "err" | "warn" | "info";
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : tone === "err"
        ? "bg-destructive/10 text-destructive"
        : tone === "warn"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "bg-primary/10 text-primary";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${cls}`}>
      {icon} {label}: <span className="font-semibold">{count}</span>
    </span>
  );
}

function StatusBadge({ status, pending }: { status: FieldMappingEntry["status"]; pending: boolean }) {
  if (pending) {
    return (
      <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-primary/15 text-primary">
        Pending
      </span>
    );
  }
  if (status === "mapped") {
    return (
      <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
        OK
      </span>
    );
  }
  if (status === "stale") {
    return (
      <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">
        Zastarelo
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-destructive/15 text-destructive">
      Nedostaje
    </span>
  );
}
