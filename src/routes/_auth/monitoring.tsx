import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { getDashboardFn, type MachineDashboardRow } from "@/lib/api/dashboard.functions";
import { formatNumber, formatDateTime } from "@/lib/i18n/format";
import {
  pauseWorkOrderFn,
  resumeWorkOrderFn,
  stopWorkOrderWithBatchFn,
  logScrapFn,
  startWorkOrderFn,
} from "@/lib/api/workorder.functions";
import { invalidateAfterAction, patchWoHistoryInsert, rollback } from "@/lib/query/invalidate";

import { Activity, ChevronDown, ChevronUp, RefreshCw, AlertTriangle, Pause, Play, Square, ClipboardCheck, PackageMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import WorkOrderDetailsDialog from "@/components/work-order/WorkOrderDetailsDialog";
import StartWorkOrderDialog, { type StartWorkOrderSubmitArgs } from "@/components/work-order/StartWorkOrderDialog";
import { LoadingOverlay } from "@/components/ui/loading-overlay";

import { ConfirmActionDialog, ScrapDialog, StopWithBatchDialog } from "@/components/work-order/dialogs";
import DowntimeModal from "@/components/shop-floor/DowntimeModal";
import InspectionModal from "@/components/shop-floor/InspectionModal";

const monitoringSearchSchema = z.object({
  wo: fallback(z.string().optional(), undefined),
  tab: fallback(z.enum(["skart", "inspekcija", "promene", "chat"]).optional(), undefined),
});

export const Route = createFileRoute("/_auth/monitoring")({
  head: () => ({ meta: [{ title: "Monitoring — MES Shop Floor" }] }),
  validateSearch: zodValidator(monitoringSearchSchema),
  component: MonitoringPage,
});


type StatusFilter = "all" | "uRadu" | "zastoj" | "nemaSig" | "off";

function statusToFilter(status: string | undefined): Exclude<StatusFilter, "all"> | "other" {
  const s = (status || "").split(" |")[0];
  if (s === "U radu") return "uRadu";
  if (s === "Zastoj") return "zastoj";
  if (s === "Nema signala") return "nemaSig";
  if (s === "OFF") return "off";
  return "other";
}

const statusColorVar: Record<string, string> = {
  uRadu: "var(--color-status-running)",
  zastoj: "var(--color-status-downtime)",
  nemaSig: "var(--color-status-nosignal)",
  off: "var(--color-status-off)",
  other: "var(--color-status-off)",
};

function MonitoringPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const call = useServerFn(getDashboardFn);
  const callPause = useServerFn(pauseWorkOrderFn);
  const callResume = useServerFn(resumeWorkOrderFn);
  const callStopBatch = useServerFn(stopWorkOrderWithBatchFn);
  const callScrap = useServerFn(logScrapFn);
  const callStart = useServerFn(startWorkOrderFn);




  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => call(),
    enabled: !!user?.id,
    refetchOnMount: "always",
    refetchInterval: 90_000 + Math.random() * 30_000,
    refetchIntervalInBackground: false,
  });

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // dialog state
  const [detailsFor, setDetailsFor] = useState<MachineDashboardRow | null>(null);
  const [detailsTab, setDetailsTab] = useState<"skart" | "inspekcija" | "promene" | "chat" | undefined>(undefined);
  const [startFor, setStartFor] = useState<MachineDashboardRow | null>(null);
  const [downtimeFor, setDowntimeFor] = useState<MachineDashboardRow | null>(null);
  const [inspectFor, setInspectFor] = useState<MachineDashboardRow | null>(null);
  const [scrapFor, setScrapFor] = useState<MachineDashboardRow | null>(null);
  const [confirmAct, setConfirmAct] = useState<{ m: MachineDashboardRow; kind: "pause" | "resume" } | null>(null);
  const [stopFor, setStopFor] = useState<MachineDashboardRow | null>(null);

  // Auto-open dialog from ?wo=<radniNalogId>&tab=chat (e.g. from notifications)
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/monitoring" });
  useEffect(() => {
    if (!search.wo || !data?.machines) return;
    const m = data.machines.find((x) => x.radniNalogId === search.wo);
    if (m) {
      setDetailsFor(m);
      setDetailsTab(search.tab);
    } else {
      toast.error(t("monitoring.woNoLongerActive"));
    }
    navigate({ search: {}, replace: true });
  }, [search.wo, search.tab, data?.machines, navigate]);



  const ctxFromVars = (v: { data?: { radniNalogId?: string; resursId?: string } } | undefined, monitoringId?: string) => ({
    radniNalogId: v?.data?.radniNalogId,
    resursId: v?.data?.resursId,
    monitoringId,
  });
  const invalidateDash = (ctx: { radniNalogId?: string; monitoringId?: string; resursId?: string } = {}) =>
    invalidateAfterAction(queryClient, ctx);

  const onErr = (e: Error) => {
    if (e?.message?.startsWith("KONFLIKT:")) {
      toast.error(e.message.replace(/^KONFLIKT:\s*/, "Konflikt: ") + " Osvežavam stanje…");
      invalidateDash();
      setConfirmAct(null);
      setStopFor(null);
    } else {
      toast.error(e.message);
    }
  };

  // Dva brza refetch-a posle akcije: odmah (invalidate) + posle ~1200ms da uhvati override.
  const invalidateTwice = (ctx: { radniNalogId?: string; monitoringId?: string; resursId?: string } = {}) => {
    invalidateAfterAction(queryClient, ctx);
    if (typeof window !== "undefined") {
      window.setTimeout(() => invalidateAfterAction(queryClient, ctx), 1200);
    }
  };

  const clearBusy = () => { setBusyCard(null); };
  const pauseM = useMutation({
    mutationFn: callPause,
    onSuccess: () => { setConfirmAct(null); toast.success("Pauza uspešna"); },
    onError: (e) => { clearBusy(); onErr(e as Error); },
    onSettled: (_d, _e, v) => invalidateTwice(ctxFromVars(v, confirmAct?.m.monitoringId)),
  });
  const resumeM = useMutation({
    mutationFn: callResume,
    onSuccess: () => { setConfirmAct(null); toast.success("Nastavak uspešan"); },
    onError: (e) => { clearBusy(); onErr(e as Error); },
    onSettled: (_d, _e, v) => invalidateTwice(ctxFromVars(v, confirmAct?.m.monitoringId)),
  });
  const stopM = useMutation({
    mutationFn: callStopBatch,
    onSuccess: () => { setStopFor(null); toast.success("Nalog zatvoren"); },
    onError: (e) => { clearBusy(); onErr(e as Error); },
    onSettled: (_d, _e, v) => invalidateTwice(ctxFromVars(v, stopFor?.monitoringId)),
  });
  const scrapM = useMutation({
    mutationFn: callScrap,
    onMutate: async (v) => {
      const woSnap = await patchWoHistoryInsert(queryClient, v.data.radniNalogId, {
        tip: "skart",
        opis: `Škart: ${v.data.kolicinaSkarta} kom${v.data.komentar ? ` — ${v.data.komentar}` : ""}`,
        operator: user?.imeIPrezime,
      });
      return { woSnap };
    },
    onSuccess: () => { setScrapFor(null); toast.success("Škart upisan"); },
    onError: (e, _v, ctx) => {
      clearBusy();
      rollback(queryClient, ctx?.woSnap);
      onErr(e as Error);
    },
    onSettled: (_d, _e, v) => invalidateTwice(ctxFromVars(v, scrapFor?.monitoringId)),
  });

  // Start/Resume — prosleđujemo monitoringId + woMeta serveru radi override-a.
  const startM = useMutation({
    mutationFn: async (args: StartWorkOrderSubmitArgs & { monitoringId: string; resursId?: string }) => {
      const data = {
        radniNalogId: args.woId,
        resursId: args.resursId,
        userId: user?.id ?? "",
        monitoringId: args.monitoringId,
        woMeta: {
          brojNaloga: args.brojNaloga,
          sifraArtikla: args.sifraArtikla,
          artikalNaziv: args.artikalNaziv,
          planiranaKolicina: args.planiranaKolicina,
        },
        ...(args.startTimeIso && !args.isResume ? { startTime: args.startTimeIso } : {}),
      };
      return args.isResume ? callResume({ data }) : callStart({ data });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["dashboard"] });
    },
    onSuccess: () => { setStartFor(null); toast.success("Nalog pokrenut"); },
    onError: (e) => {
      clearBusy();
      onErr(e as Error);
    },
    onSettled: (_d, _e, args) => invalidateTwice({
      radniNalogId: args.woId,
      monitoringId: args.monitoringId,
      resursId: args.resursId,
    }),
  });

  // Per-karticu overlay tracking — gasi se posle prvog refetch-a koji uhvati override.
  const [busyCard, setBusyCard] = useState<{ id: string; label: string } | null>(null);
  const sawFetchRef = useRef(false);
  const busyDeadlineRef = useRef(0);
  const anyPending =
    startM.isPending || pauseM.isPending || resumeM.isPending ||
    stopM.isPending || scrapM.isPending;

  function beginCardBusy(id: string, label: string) {
    sawFetchRef.current = false;
    busyDeadlineRef.current = Date.now() + 6000;
    setBusyCard({ id, label });
  }

  // Zabeleži da je refetch krenuo
  useEffect(() => {
    if (busyCard && isFetching) sawFetchRef.current = true;
  }, [busyCard, isFetching]);

  // Očisti tek kad: nije pending, refetch se desio i završio (ili hard cap)
  useEffect(() => {
    if (!busyCard) return;
    const settledAfterFetch = !anyPending && sawFetchRef.current && !isFetching;
    const timedOut = Date.now() >= busyDeadlineRef.current;
    if (settledAfterFetch || timedOut) {
      const t = window.setTimeout(() => setBusyCard(null), 50);
      return () => window.clearTimeout(t);
    }
    const remaining = Math.max(500, busyDeadlineRef.current - Date.now());
    const t = window.setTimeout(() => setBusyCard((c) => (c ? { ...c } : c)), remaining);
    return () => window.clearTimeout(t);
  }, [busyCard, anyPending, isFetching]);

  const overlayShow = !!busyCard;


  const machines = useMemo(() => {
    const arr = [...(data?.machines || [])];
    arr.sort((a, b) => a.nazivLinije.localeCompare(b.nazivLinije, "sr", { sensitivity: "base", numeric: true }));
    return arr;
  }, [data]);

  const filtered = useMemo(() => {
    if (filter === "all") return machines;
    return machines.filter((m) => statusToFilter(m.statusMasine) === filter);
  }, [machines, filter]);

  const perms = user?.permissions;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <header className="hidden lg:flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Monitoring</h1>
        {data && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-primary" />
            Proizvodnih linija <span className="font-semibold text-foreground">{data.kpis.total}</span>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <KpiCard label="U radu" value={data?.kpis.uRadu ?? 0} color="var(--color-status-running)" active={filter === "uRadu"} onClick={() => setFilter(filter === "uRadu" ? "all" : "uRadu")} />
        <KpiCard label="Zastoj" value={data?.kpis.zastoj ?? 0} color="var(--color-status-downtime)" active={filter === "zastoj"} onClick={() => setFilter(filter === "zastoj" ? "all" : "zastoj")} />
        <KpiCard label="Nema signala" value={data?.kpis.nemaSig ?? 0} color="var(--color-status-nosignal)" active={filter === "nemaSig"} onClick={() => setFilter(filter === "nemaSig" ? "all" : "nemaSig")} />
        <KpiCard label="OFF" value={data?.kpis.off ?? 0} color="var(--color-status-off)" active={filter === "off"} onClick={() => setFilter(filter === "off" ? "all" : "off")} />
      </div>


      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {filter === "all" ? `${filtered.length} mašina` : `${filtered.length} od ${machines.length} mašina`}
        </div>
        <div className="flex items-center gap-2">
          {filter !== "all" && (
            <Button variant="ghost" size="sm" onClick={() => setFilter("all")}>Poništi filter</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className={`size-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Osveži
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-muted-foreground">Učitavanje...</div>}
      {isError && !isLoading && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm flex items-center justify-between gap-3">
          <div className="text-destructive">
            Greška pri učitavanju podataka sa Airtable: {(error as Error)?.message ?? "nepoznata greška"}
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`size-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Pokušaj ponovo
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((m) => (
          <MachineRow
            key={m.monitoringId}
            m={m}
            expanded={!!expanded[m.monitoringId]}
            onToggle={() => setExpanded((p) => ({ ...p, [m.monitoringId]: !p[m.monitoringId] }))}
            perms={perms}
            busy={busyCard?.id === m.monitoringId && overlayShow}
            busyLabel={busyCard?.id === m.monitoringId ? busyCard.label : undefined}
            onOpenDetails={() => setDetailsFor(m)}
            onStart={() => setStartFor(m)}
            onPause={() => setConfirmAct({ m, kind: "pause" })}
            onResume={() => setConfirmAct({ m, kind: "resume" })}
            onStop={() => setStopFor(m)}
            onDowntime={() => setDowntimeFor(m)}
            onInspect={() => setInspectFor(m)}
            onScrap={() => setScrapFor(m)}
          />

        ))}
        {!isLoading && filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
            Nema mašina za prikaz.
          </div>
        )}
      </div>

      {/* Dialogs */}
      <WorkOrderDetailsDialog open={!!detailsFor} onOpenChange={(v) => { if (!v) { setDetailsFor(null); setDetailsTab(undefined); } }} m={detailsFor} defaultTab={detailsTab} key={`${detailsFor?.monitoringId ?? "none"}:${detailsTab ?? "default"}`} />

      {startFor && (
        <StartWorkOrderDialog
          open={!!startFor}
          onOpenChange={(v) => !v && setStartFor(null)}
          resursId={startFor.resursiId}
          title={startFor.nazivLinije}
          pending={startM.isPending}
          onSubmit={(args) => {
            beginCardBusy(startFor.monitoringId, "Pokretanje naloga…");
            startM.mutate({ ...args, monitoringId: startFor.monitoringId, resursId: startFor.resursiId });
          }}
        />
      )}


      {downtimeFor && (
        <DowntimeModal
          open={!!downtimeFor}
          onOpenChange={(v) => !v && setDowntimeFor(null)}
          monitoringId={downtimeFor.monitoringId}
          userId={user?.id || ""}
          radniNalogId={downtimeFor.radniNalogId}
          resursId={downtimeFor.resursiId}
          onSubmitted={({ ongoing, grupaNaziv }) => {
            if (!downtimeFor) return;
            if (ongoing && grupaNaziv) {
              beginCardBusy(downtimeFor.monitoringId, "Definisanje zastoja…");
            } else if (!ongoing) {
              beginCardBusy(downtimeFor.monitoringId, "Podela zastoja…");
            } else {
              beginCardBusy(downtimeFor.monitoringId, "Čuvanje…");
            }
          }}
        />
      )}

      {inspectFor?.radniNalogId && (
        <InspectionModal
          open={!!inspectFor}
          onOpenChange={(v) => !v && setInspectFor(null)}
          radniNalogId={inspectFor.radniNalogId}
          userId={user?.id || ""}
          brojNaloga={inspectFor.brojNaloga}
          monitoringId={inspectFor.monitoringId}
          resursId={inspectFor.resursiId}
        />
      )}

      {confirmAct && (
        <ConfirmActionDialog
          open={!!confirmAct}
          onOpenChange={(v) => !v && setConfirmAct(null)}
          kind={confirmAct.kind}
          brojNaloga={confirmAct.m.brojNaloga}
          pending={pauseM.isPending || resumeM.isPending}
          onConfirm={(komentar) => {
            const args = {
              data: {
                radniNalogId: confirmAct.m.radniNalogId ?? "",
                resursId: confirmAct.m.resursiId,
                userId: user?.id ?? "",
                monitoringId: confirmAct.m.monitoringId,
                komentar,
              },
            };
            beginCardBusy(
              confirmAct.m.monitoringId,
              confirmAct.kind === "pause" ? "Pauziranje…" : "Nastavljanje…",
            );
            if (confirmAct.kind === "pause") pauseM.mutate(args);
            else resumeM.mutate(args);
          }}
        />
      )}

      {stopFor && (
        <StopWithBatchDialog
          open={!!stopFor}
          onOpenChange={(v) => !v && setStopFor(null)}
          brojNaloga={stopFor.brojNaloga}
          pending={stopM.isPending}
          onConfirm={(payload) => {
            beginCardBusy(stopFor.monitoringId, "Zatvaranje naloga…");
            stopM.mutate({
              data: {
                radniNalogId: stopFor.radniNalogId ?? "",
                resursId: stopFor.resursiId,
                userId: user?.id ?? "",
                monitoringId: stopFor.monitoringId,
                ...payload,
              },
            });
          }}
        />
      )}

      {scrapFor && (
        <ScrapDialog
          open={!!scrapFor}
          onOpenChange={(v) => !v && setScrapFor(null)}
          pending={scrapM.isPending}
          onConfirm={(payload) => {
            beginCardBusy(scrapFor.monitoringId, "Upis škarta…");
            scrapM.mutate({
              data: {
                radniNalogId: scrapFor.radniNalogId ?? "",
                resursId: scrapFor.resursiId,
                userId: user?.id ?? "",
                monitoringId: scrapFor.monitoringId,
                prevSkart: scrapFor.skart ?? 0,
                ...payload,
              },
            });
          }}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, color, active, onClick }: { label: string; value: number; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border bg-card p-4 transition hover:bg-accent/50 ${active ? "ring-2 ring-offset-2 ring-offset-background" : "border-border"}`}
      style={active ? { borderColor: color, boxShadow: `0 0 0 1px ${color}` } : undefined}
    >
      <div className="flex items-center gap-3">
        <Activity className="size-5" style={{ color }} />
        <div>
          <div className="text-3xl font-semibold leading-none" style={{ color }}>{value}</div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </div>
      </div>
    </button>
  );
}

type Perms = ReturnType<typeof useAuth>["user"] extends infer U
  ? U extends { permissions: infer P } ? P : undefined
  : undefined;

function MachineRow({
  m, expanded, onToggle, perms, busy, busyLabel,
  onOpenDetails, onStart, onPause, onResume, onStop, onDowntime, onInspect, onScrap,
}: {
  m: MachineDashboardRow;
  expanded: boolean;
  onToggle: () => void;
  perms: Perms | undefined;
  busy?: boolean;
  busyLabel?: string;
  onOpenDetails: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDowntime: () => void;
  onInspect: () => void;
  onScrap: () => void;
}) {

  const fkey = statusToFilter(m.statusMasine);
  const color = statusColorVar[fkey];
  const isZastoj = fkey === "zastoj";
  const realizacijaPct = (m.procenatRealizacije ?? 0) * 100;
  const goodQty = m.dobroProizvedeno ?? m.ispravnoProizvedeno ?? 0;
  const overproduction = m.planiranaKolicina != null && m.planiranaKolicina > 0 && goodQty > m.planiranaKolicina;

  const status = m.statusNaloga;
  const hasActiveWO = !!m.brojNaloga;
  const isRunningWO = status === "U radu";
  const isPausedWO = status === "Pauziran";

  const canStart = !!perms?.startWorkOrder;
  const canResume = !!perms?.resumeWorkOrder;
  const canPause = !!perms?.pauseWorkOrder;
  const canStop = !!perms?.stopWorkOrder;
  const canDowntime = !!perms?.logDowntime;
  const canInspect = !!perms?.performInspection;
  const canScrap = !!perms?.logScrap;

  const showStart = !hasActiveWO && canStart;
  const showResume = hasActiveWO && isPausedWO && canResume;
  const showPause = hasActiveWO && isRunningWO && canPause;
  const showStop = hasActiveWO && canStop && status !== "Završen";
  const showDowntime = isZastoj && canDowntime;
  const showScrap = hasActiveWO && canScrap;
  const showInspect = hasActiveWO && canInspect && !!m.radniNalogId;
  const hasAnyAction = showDowntime || showStart || showResume || showPause || showStop || showScrap || showInspect;

  const lbl = "hidden sm:inline";
  const ico = "sm:mr-2";

  const actionButtons = (
    <>
      {showScrap && (
        <Button
          variant="outline"
          size="sm"
          aria-label="Unos škarta"
          className="border-[color:var(--color-status-downtime)] text-[color:var(--color-status-downtime)]"
          onClick={onScrap}
        >
          <PackageMinus className={`size-4 ${ico}`} /> <span className={lbl}>Unos škarta</span>
        </Button>
      )}
      {showInspect && (
        <Button variant="outline" size="sm" aria-label="Inspekcija" onClick={onInspect}>
          <ClipboardCheck className={`size-4 ${ico}`} /> <span className={lbl}>Inspekcija</span>
        </Button>
      )}
      {showDowntime && (
        <Button
          variant="outline"
          size="sm"
          aria-label="Prijavi zastoj"
          className="border-[color:var(--color-status-downtime)] text-[color:var(--color-status-downtime)]"
          onClick={onDowntime}
        >
          <AlertTriangle className={`size-4 ${ico}`} /> <span className={lbl}>Prijavi zastoj</span>
        </Button>
      )}
      {showStart && (
        <Button size="sm" aria-label="Pokreni" onClick={onStart}>
          <Play className={`size-4 ${ico}`} /> <span className={lbl}>Pokreni</span>
        </Button>
      )}
      {showResume && (
        <Button size="sm" aria-label="Nastavi" onClick={onResume}>
          <Play className={`size-4 ${ico}`} /> <span className={lbl}>Nastavi</span>
        </Button>
      )}
      {showPause && (
        <Button variant="outline" size="sm" aria-label="Pauziraj" onClick={onPause}>
          <Pause className="size-4" />
        </Button>
      )}
      {showStop && (
        <Button
          size="sm"
          aria-label="STOP"
          onClick={onStop}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          <Square className={`size-4 fill-current ${ico}`} /> <span className={lbl}>STOP</span>
        </Button>
      )}
    </>
  );

  const actions = hasAnyAction ? (
    <div className="border-t border-border px-4 py-2.5 flex flex-wrap gap-2 justify-end">
      {actionButtons}
    </div>
  ) : null;

  const stats = !isZastoj ? (
    <>
      <Stat label="Planiran ciklus" value={m.projektovanCiklusSek != null ? `${fmtSec(m.projektovanCiklusSek)} s` : "—"} />
      <Stat label="Trenutni ciklus" value={m.trenutniCiklusSek != null ? `${m.trenutniCiklusSek.toLocaleString("sr", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s` : "—"} />
      <Stat
        label="Performanse"
        value={m.performanse != null ? `${(m.performanse * 100).toFixed(1)}%` : "—"}
        valueColor={perfColor(m.performanse)}
      />
      <Stat label="Preostalo vreme" value={m.procenjenoTrajanje || "—"} />
    </>
  ) : (
    <>
      <div className="col-span-2 min-w-0">
        <div className="text-xs text-muted-foreground uppercase">Zastoj</div>
        <div className="font-semibold truncate">{m.grupaZastoja || "Nedefinisan zastoj"}</div>
        {m.tipZastojaDetail && <div className="text-xs text-muted-foreground truncate">{m.tipZastojaDetail}</div>}
      </div>
      <Stat label="Trajanje" value={m.trajanjeZastoja || "—"} />
    </>
  );

  return (
    <div className="relative rounded-xl border border-border bg-card overflow-hidden border-l-4" style={{ borderLeftColor: color }}>
      <LoadingOverlay show={!!busy} label={busyLabel ?? "Osvežavanje…"} />

      {/* Top row: machine + stats + actions */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 px-4 py-2.5">
        <div className="flex items-center gap-3 min-w-0 md:w-[260px]">
          {m.avatarUrl ? (
            <img src={m.avatarUrl} alt={m.nazivLinije} className="size-11 rounded object-cover shrink-0" />
          ) : (
            <div className="size-11 rounded bg-muted shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate">{m.nazivLinije}</div>
            <span
              className="inline-flex items-center gap-1.5 mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: `color-mix(in oklab, ${color} 15%, transparent)`, color }}
            >
              <span className="size-1.5 rounded-full" style={{ background: color }} />
              {m.statusMasine || ""}
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
          {stats}
        </div>
      </div>


      {/* Work order row */}
      {m.brojNaloga && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          <div className="grid grid-cols-12 gap-4 items-start">
            <div className="col-span-12 md:col-span-2">
              <div className="text-xs text-muted-foreground uppercase">Radni nalog</div>
              <button
                onClick={onOpenDetails}
                className="font-semibold underline underline-offset-2 hover:text-primary text-left"
              >
                {m.brojNaloga}
              </button>
            </div>
            <div className="col-span-12 md:col-span-7 min-w-0">
              <div className="truncate">
                {m.sifraArtikla ? <span className="font-medium">{m.sifraArtikla} | </span> : null}
                {m.artikalNaziv}
              </div>
              {m.narucilac && <div className="text-xs text-muted-foreground truncate">{m.narucilac}</div>}
            </div>
            <div className="col-span-12 md:col-span-3 md:text-right">
              <div className="text-xs text-muted-foreground uppercase">Aktivni posao</div>
              {m.vremeOtvaranjaNaloga && (
                <div className="text-xs">Počeo: {fmtDateTime(m.vremeOtvaranjaNaloga)}</div>
              )}
              {m.ciklusiTotal != null && (
                <div className="text-xs">Proizvodnja: {m.ciklusiTotal.toLocaleString("sr")} ciklusa</div>
              )}
            </div>
          </div>

          {/* Progress */}
          {m.planiranaKolicina != null && (
            <div className="flex-1 min-w-0">
              <RealizationBar
                good={goodQty}
                scrap={m.skart ?? 0}
                scrapPct={m.procenatSkarta}
                target={m.planiranaKolicina}
                overproduction={overproduction}
              />
            </div>
          )}

          {/* Actions */}
          {hasActiveWO && hasAnyAction && (
            <div className="flex flex-wrap gap-2 justify-end pt-2">
              {actionButtons}
            </div>
          )}

          {/* Toggle */}
          <div>
            <button onClick={onToggle} className="text-primary text-sm inline-flex items-center gap-1 hover:underline">
              {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              {expanded ? "Sakrij detalje" : "Prikaži detalje"}
            </button>
          </div>

          {expanded && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 pt-2 border-t border-border">
              <Stat label="Planirana količina" value={`${(m.planiranaKolicina ?? 0).toLocaleString("sr")} kom`} />
              <Stat label="Proizvedeno" value={`${goodQty.toLocaleString("sr")} kom`} />
              <Stat
                label="Realizacija"
                value={`${realizacijaPct.toFixed(1)}%`}
                valueColor={overproduction ? "var(--color-status-downtime)" : undefined}
              />
              <Stat label="Škart" value={`${(m.skart ?? 0).toLocaleString("sr")} kom`} valueColor="var(--color-status-nosignal)" />
              <Stat label="Procenat škarta" value={m.procenatSkarta != null ? `${(m.procenatSkarta * 100).toFixed(1)}%` : "—"} />
              <Stat label="Preostalo" value={`${(m.preostaloZaProizvodnju ?? 0).toLocaleString("sr")} kom`} />
            </div>
          )}
        </div>
      )}

      {!m.brojNaloga && !isZastoj && (
        <div className="border-t border-border px-4 py-3">
          <div className="text-sm text-muted-foreground italic">Nema aktivnog naloga na ovoj mašini.</div>
        </div>
      )}

      {!hasActiveWO && actions}
    </div>
  );
}

function Stat({ label, value, valueColor, className }: { label: string; value: string; valueColor?: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground uppercase">{label}</div>
      <div className="font-semibold" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
    </div>
  );
}

function RealizationBar({
  good,
  scrap,
  scrapPct,
  target,
  overproduction,
}: {
  good: number;
  scrap: number;
  scrapPct?: number;
  target: number;
  overproduction?: boolean;
}) {
  const goodW = target > 0 ? Math.max(0, Math.min(100, (good / target) * 100)) : 0;
  const remW = overproduction ? 0 : Math.max(0, 100 - goodW);
  const remaining = Math.max(0, target - good);
  const scrapW = target > 0 ? Math.max(0, Math.min(goodW, (scrap / target) * 100)) : 0;
  const pctTxt =
    scrapPct != null
      ? `${(scrapPct * 100).toFixed(2)}%`
      : scrap > 0 && target > 0
        ? `${((scrap / target) * 100).toFixed(2)}%`
        : "0%";
  const goodBg = overproduction ? "var(--color-status-downtime)" : "var(--color-status-running)";
  return (
    <div className="relative h-7 rounded-md overflow-hidden flex w-full bg-secondary text-xs font-medium">
      {goodW > 0 && (
        <div
          className="h-full flex items-center justify-end pr-2 text-white whitespace-nowrap"
          style={{ width: `${goodW}%`, background: goodBg }}
        >
          {good.toLocaleString("sr")}
        </div>
      )}
      {remW > 0 && (
        <div
          className="h-full flex items-center justify-end pr-2 text-muted-foreground whitespace-nowrap"
          style={{ width: `${remW}%` }}
        >
          {remaining.toLocaleString("sr")}
        </div>
      )}
      {scrap > 0 && (
        <div
          className="absolute left-0 top-0 h-full flex items-center justify-start pl-2 text-white whitespace-nowrap pointer-events-none"
          style={{ width: `${scrapW}%`, minWidth: "fit-content", background: "#F59E0B" }}
        >
          {scrap.toLocaleString("sr")} ({pctTxt})
        </div>
      )}
    </div>
  );
}

function perfColor(perf?: number): string | undefined {
  if (perf == null) return undefined;
  const p = Math.abs(perf * 100);
  if (p <= 3) return "var(--color-status-running)";
  if (p <= 10) return "#F59E0B";
  return "var(--color-status-downtime)";
}

function fmtSec(n: number): string {
  return n.toLocaleString("sr", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function fmtDateTime(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleString("sr", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return s;
  }
}
