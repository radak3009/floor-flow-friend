import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation, Trans } from "react-i18next";
import { formatDateTime, formatNumber, pickName } from "@/lib/i18n/format";
import { getDashboardFn, type DashboardResult, type MachineDashboardRow } from "@/lib/api/dashboard.functions";
import {
  getWorkOrderHistoryFn,
  getAvailableWorkOrdersFn,
  getDropdownDataFn,
  type PromenaRow,
  type AvailableWorkOrder,
} from "@/lib/api/workorder.functions";
import WorkOrderDetailsDialog from "@/components/work-order/WorkOrderDetailsDialog";
import StartWorkOrderDialog, { type StartWorkOrderSubmitArgs } from "@/components/work-order/StartWorkOrderDialog";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/ui/async-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingOverlay } from "@/components/ui/loading-overlay";
import { Play, Pause, Square, RotateCcw, RefreshCw, FileText, PackageMinus, ChevronLeft, ChevronRight, ListChecks, AlertOctagon, Factory, AlertTriangle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import DowntimeModal from "@/components/shop-floor/DowntimeModal";
import InspectionModal from "@/components/shop-floor/InspectionModal";
import { enqueue } from "@/lib/offline/outbox";

import { invalidateAfterAction, invalidateAfterActionDelayed, patchWoHistoryInsert, rollback } from "@/lib/query/invalidate";




export const Route = createFileRoute("/_auth/shop-floor")({
  head: () => ({ meta: [{ title: "Shop Floor — MES" }] }),
  component: ShopFloorPage,
});

function isRunning(status?: string) {
  return !!status && status.startsWith("U radu");
}

function ShopFloorPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const callDashboard = useServerFn(getDashboardFn);
  const callHistory = useServerFn(getWorkOrderHistoryFn);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => callDashboard(),
    enabled: !!user?.id,
    refetchOnMount: "always",
    refetchInterval: 90_000 + Math.random() * 30_000,
    refetchIntervalInBackground: false,
  });

  const [selected, setSelected] = useState<string>("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [scrapOpen, setScrapOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [inspectionOpen, setInspectionOpen] = useState(false);

  

  const machines = useMemo(() => {
    const arr = [...(data?.machines || [])];
    arr.sort((a, b) => a.nazivLinije.localeCompare(b.nazivLinije, "sr", { sensitivity: "base", numeric: true }));
    return arr;
  }, [data]);

  const m = machines.find((x) => x.monitoringId === selected);

  const history = useQuery({
    queryKey: ["wo-history", m?.radniNalogId],
    queryFn: () => callHistory({ data: { radniNalogId: (m?.radniNalogId ?? ""), limit: 50 } }),
    enabled: !!m?.radniNalogId && !!user?.permissions.viewHistory,
    refetchInterval: 120_000 + Math.random() * 30_000,
    refetchIntervalInBackground: false,
  });

  const actionCtx = () => ({
    radniNalogId: m?.radniNalogId,
    monitoringId: m?.monitoringId,
    resursId: m?.resursiId,
  });
  const invalidateAll = () => invalidateAfterAction(queryClient, actionCtx());
  const handleResult = (res: { queued: boolean }, label: string) => {
    if (res.queued) toast.success(t("shopFloor.savedLocally"));
    else toast.success(t("shopFloor.actionSuccess", { label }));
    invalidateAll();
  };
  const onActionError = (e: Error) => toast.error(e.message);

  /**
   * Optimistički ažurira ["dashboard"] cache za izabranu mašinu.
   * Vraća snapshot za rollback u onError.
   */
  async function optimisticPatch(patch: (row: MachineDashboardRow) => MachineDashboardRow) {
    await queryClient.cancelQueries({ queryKey: ["dashboard"] });
    const prev = queryClient.getQueryData<DashboardResult>(["dashboard"]);
    if (!prev || !m) return { prev };
    const next: DashboardResult = {
      ...prev,
      machines: prev.machines.map((row) =>
        row.monitoringId === m.monitoringId ? patch(row) : row,
      ),
    };
    queryClient.setQueryData<DashboardResult>(["dashboard"], next);
    return { prev };
  }

  const pauseM = useMutation({
    mutationFn: (payload: { radniNalogId: string; resursId?: string; userId: string; komentar?: string; monitoringId?: string }) =>
      enqueue("pauseWorkOrder", `Pauza naloga ${m?.brojNaloga ?? ""}`.trim(), { ...payload, monitoringId: m?.monitoringId }),
    onMutate: async () => {
      const prevDash = await optimisticPatch((r) => ({ ...r, statusNaloga: "Pauziran", statusMasine: "Zastoj" }));
      const woSnap = await patchWoHistoryInsert(queryClient, m?.radniNalogId, {
        tip: "pauza",
        opis: `Pauza naloga ${m?.brojNaloga ?? ""}`.trim(),
        operator: user?.imeIPrezime,
      });
      return { prevDash, woSnap };
    },
    onSuccess: (res) => { setPauseOpen(false); handleResult(res, t("shopFloor.labelPause")); },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prevDash?.prev) queryClient.setQueryData(["dashboard"], ctx.prevDash.prev);
      rollback(queryClient, ctx?.woSnap);
      onActionError(e);
    },
    onSettled: () => invalidateAfterActionDelayed(queryClient, actionCtx()),
  });
  const stopM = useMutation({
    mutationFn: (payload: { radniNalogId: string; resursId?: string; userId: string; dobroProizvedeno: number; kolicinaSkarta?: number; grupaSkartaId?: string; tipSkartaId?: string; komentar?: string; monitoringId?: string }) =>
      enqueue("stopWorkOrderWithBatch", `Završetak naloga ${m?.brojNaloga ?? ""}`.trim(), { ...payload, monitoringId: m?.monitoringId }),
    onMutate: async (payload) => {
      const prevDash = await optimisticPatch((r) => ({
        ...r,
        statusNaloga: "Završen",
        dobroProizvedeno: payload.dobroProizvedeno ?? r.dobroProizvedeno,
        skart: (r.skart ?? 0) + (payload.kolicinaSkarta ?? 0),
      }));
      const woSnap = await patchWoHistoryInsert(queryClient, m?.radniNalogId, {
        tip: "stop",
        opis: `Završetak naloga ${m?.brojNaloga ?? ""} (dobro: ${payload.dobroProizvedeno})`.trim(),
        operator: user?.imeIPrezime,
      });
      return { prevDash, woSnap };
    },
    onSuccess: (res) => { setStopOpen(false); handleResult(res, t("shopFloor.labelStop")); },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prevDash?.prev) queryClient.setQueryData(["dashboard"], ctx.prevDash.prev);
      rollback(queryClient, ctx?.woSnap);
      onActionError(e);
    },
    onSettled: () => invalidateAfterActionDelayed(queryClient, actionCtx()),
  });
  const scrapM = useMutation({
    mutationFn: (payload: { radniNalogId: string; resursId?: string; userId: string; kolicinaSkarta: number; grupaSkartaId: string; tipSkartaId: string; komentar?: string; monitoringId?: string; prevSkart?: number }) =>
      enqueue("logScrap", `Škart ${payload.kolicinaSkarta} kom — ${m?.brojNaloga ?? ""}`.trim(), { ...payload, monitoringId: m?.monitoringId, prevSkart: m?.skart ?? 0 }),
    onMutate: async (payload) => {
      const prevDash = await optimisticPatch((r) => ({ ...r, skart: (r.skart ?? 0) + payload.kolicinaSkarta }));
      const woSnap = await patchWoHistoryInsert(queryClient, m?.radniNalogId, {
        tip: "skart",
        opis: `Škart: ${payload.kolicinaSkarta} kom${payload.komentar ? ` — ${payload.komentar}` : ""}`,
        operator: user?.imeIPrezime,
      });
      return { prevDash, woSnap };
    },
    onSuccess: (res) => { setScrapOpen(false); handleResult(res, t("shopFloor.labelScrap")); },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prevDash?.prev) queryClient.setQueryData(["dashboard"], ctx.prevDash.prev);
      rollback(queryClient, ctx?.woSnap);
      onActionError(e);
    },
    onSettled: () => invalidateAfterActionDelayed(queryClient, actionCtx()),
  });

  const busy = pauseM.isPending || stopM.isPending || scrapM.isPending;

  // Start/Resume mutation sa optimistic patch (vidi src/components/work-order/StartWorkOrderDialog.tsx)
  const startM = useMutation({
    mutationFn: async (args: StartWorkOrderSubmitArgs) => {
      const type = args.isResume ? "resumeWorkOrder" : "startWorkOrder";
      const label = `${args.isResume ? "Nastavak" : "Pokretanje"} naloga ${args.brojNaloga ?? ""}`.trim();
      const payload: Record<string, unknown> = {
        radniNalogId: args.woId,
        resursId: m?.resursiId,
        userId: user?.id || "",
        monitoringId: m?.monitoringId,
        woMeta: {
          brojNaloga: args.brojNaloga,
          sifraArtikla: args.sifraArtikla,
          artikalNaziv: args.artikalNaziv,
          planiranaKolicina: args.planiranaKolicina,
        },
      };
      if (!args.isResume && args.startTimeIso) payload.startTime = args.startTimeIso;
      return enqueue(type, label, payload);
    },
    onMutate: (args) => optimisticPatch((r) => ({
      ...r,
      statusNaloga: "U radu",
      statusMasine: "U radu",
      radniNalogId: args.woId,
      brojNaloga: args.brojNaloga ?? r.brojNaloga,
      sifraArtikla: args.sifraArtikla ?? r.sifraArtikla,
      artikalNaziv: args.artikalNaziv ?? r.artikalNaziv,
      planiranaKolicina: args.planiranaKolicina ?? r.planiranaKolicina,
    })),
    onSuccess: (res) => {
      setStartOpen(false);
      handleResult(res, t("shopFloor.labelStart"));
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["dashboard"], ctx.prev);
      if (e?.message?.startsWith("KONFLIKT:")) {
        toast.error(t("shopFloor.conflictPrefix") + e.message.replace(/^KONFLIKT:\s*/, "") + t("shopFloor.conflictRefresh"));
        queryClient.invalidateQueries({ queryKey: ["available-wo"] });
      } else {
        onActionError(e);
      }
    },
    onSettled: (_d, _e, args) => invalidateAfterActionDelayed(queryClient, {
      radniNalogId: args.woId,
      monitoringId: m?.monitoringId,
      resursId: m?.resursiId,
    }),
  });

  // Overlay vidljiv dok traje akcija ILI prvi refetch posle nje (max 1 ciklus isFetching)
  const [postActionRefresh, setPostActionRefresh] = useState(false);
  const anyActionPending = startM.isPending || pauseM.isPending || stopM.isPending || scrapM.isPending;
  useEffect(() => {
    if (anyActionPending) setPostActionRefresh(true);
    else if (postActionRefresh && !isFetching) {
      // Sačekaj jedan tick da dashboard krene da refetcuje, pa ugasi
      const t = window.setTimeout(() => setPostActionRefresh(false), 50);
      return () => window.clearTimeout(t);
    }
  }, [anyActionPending, isFetching, postActionRefresh]);
  const overlayShow = anyActionPending || (postActionRefresh && isFetching);


  function actionArgs() {
    return {
      data: {
        radniNalogId: (m?.radniNalogId ?? ""),
        resursId: (m?.resursiId ?? ""),
        userId: (user?.id ?? ""),
      },
    };
  }

  const status = m?.statusNaloga;
  const perms = user?.permissions;
  const hasActiveWO = !!m?.brojNaloga;
  const isRunningStatus = status === "U radu";

  const canStart = !!perms?.startWorkOrder || !!perms?.resumeWorkOrder;
  const canPause = !!perms?.pauseWorkOrder && isRunningStatus;
  const canStop = !!perms?.stopWorkOrder && hasActiveWO && status !== "Završen";
  const canScrap = !!perms?.logScrap && !!m?.radniNalogId;

  const showStart = (!!perms?.startWorkOrder || !!perms?.resumeWorkOrder) && hasActiveWO && !isRunningStatus;
  const showPause = !!perms?.pauseWorkOrder && isRunningStatus;
  const showStop = !!perms?.stopWorkOrder && hasActiveWO;
  const showScrap = !!perms?.logScrap && hasActiveWO;
  const showInspection = !!perms?.performInspection && hasActiveWO;
  const canInspection = !!perms?.performInspection && !!m?.radniNalogId;
  const showAvailableList = !hasActiveWO && !!m?.resursiId && !!perms?.startWorkOrder;
  const showDowntimeBtn = !!perms?.logDowntime && !!m && ["Zastoj", "Nema signala", "OFF"].includes(m.statusMasine);

  
  const isDowntime = m?.statusMasine === "Zastoj";

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <header className="hidden lg:flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">{t("shopFloor.title")}</h1>
        <div className="text-sm text-muted-foreground">{data ? t("shopFloor.linesCount", { count: data.kpis.total }) : ""}</div>
      </header>


      <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{t("shopFloor.machine")}</div>
      <div className="flex gap-2 mb-6">
        <div className="flex-1">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder={isLoading ? t("shopFloor.loadingMachines") : t("shopFloor.selectMachine")}>
                {m && (
                  <span className="flex items-center gap-2">
                    <StatusDot running={isRunning(m.statusMasine)} />
                    <span className="font-medium">{m.nazivLinije}</span>
                    <span className="text-muted-foreground">— {m.statusMasine || ""}</span>
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {machines.map((x) => (
                <SelectItem key={x.monitoringId} value={x.monitoringId} className="h-11">
                  <span className="flex items-center gap-2">
                    <StatusDot running={isRunning(x.statusMasine)} />
                    <span className="font-medium">{x.nazivLinije}</span>
                    <span className="text-muted-foreground">{x.statusMasine || ""}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="secondary" className="h-12" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {m && isDowntime && <DowntimeInfoCard m={m} />}

      {m && m.brojNaloga && (
        <div className="relative rounded-xl border border-border bg-card overflow-hidden">
          <LoadingOverlay show={overlayShow} label={t("shopFloor.loadingData")} />


          <div className="p-4 md:p-5 grid gap-4">
            <div className="grid gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">{t("shopFloor.activeWorkOrder")}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <button
                      onClick={() => setDetailsOpen(true)}
                      className="text-2xl font-semibold underline underline-offset-4 hover:text-primary"
                    >
                      {m.brojNaloga}
                    </button>
                    <Button size="icon" variant="ghost" className="size-8 rounded-full" onClick={() => setDetailsOpen(true)} title={t("shopFloor.workOrderDetails")}>
                      <FileText className="size-4" />
                    </Button>
                  </div>
                  <div className="text-sm mt-1">
                    {m.sifraArtikla && <span className="font-medium">{m.sifraArtikla} | </span>}
                    {m.artikalNaziv}
                  </div>
                  {m.narucilac && <div className="text-xs text-muted-foreground">{m.narucilac}</div>}
                  {status && <div className="text-xs mt-1">{t("shopFloor.statusLabel")}: <span className="font-medium">{status}</span></div>}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 md:gap-3">
                <Kpi label={t("shopFloor.plannedQty")} value={m.planiranaKolicina ?? 0} />
                <Kpi label={t("shopFloor.good")} value={m.dobroProizvedeno ?? m.ispravnoProizvedeno ?? 0} accent="var(--color-status-running)" />
                <Kpi label={t("shopFloor.scrap")} value={m.skart ?? 0} accent="var(--color-status-downtime)" />
              </div>

              <ProductionBar
                good={m.dobroProizvedeno ?? m.ispravnoProizvedeno ?? 0}
                scrap={m.skart ?? 0}
                target={m.planiranaKolicina ?? 0}
              />
            </div>
          </div>

          <div className="border-t border-border p-3 md:p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
              {showStart && (
                <BigActionButton
                  icon={status === "Pauziran" ? <RotateCcw className="size-6" /> : <Play className="size-6" />}
                  label={status === "Pauziran" ? t("shopFloor.resume") : t("shopFloor.start")}
                  onClick={() => setStartOpen(true)}
                  disabled={busy || !canStart}
                />
              )}
              {showPause && (
                <BigActionButton
                  icon={<Pause className="size-6" />}
                  label={t("shopFloor.pause")}
                  onClick={() => setPauseOpen(true)}
                  disabled={busy || !canPause}
                />
              )}
              {showStop && (
                <BigActionButton
                  icon={<Square className="size-6" />}
                  label={t("shopFloor.stop")}
                  tone="destructive"
                  onClick={() => setStopOpen(true)}
                  disabled={busy || !canStop}
                />
              )}
              {showScrap && (
                <BigActionButton
                  icon={<PackageMinus className="size-6" />}
                  label={t("shopFloor.scrapBtn")}
                  tone="warning"
                  onClick={() => setScrapOpen(true)}
                  disabled={!canScrap}
                />
              )}
              {showInspection && (
                <BigActionButton
                  icon={<ListChecks className="size-6" />}
                  label={t("shopFloor.inspection")}
                  onClick={() => setInspectionOpen(true)}
                  disabled={!canInspection}
                />
              )}

          </div>
        </div>
        </div>
      )}

      {showDowntimeBtn && m && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:gap-3">
          <BigActionButton icon={<AlertTriangle className="size-6" />} label={t("shopFloor.reportDowntime")} tone="warning" onClick={() => setDowntimeOpen(true)} />
        </div>
      )}

      {showAvailableList && m?.resursiId && (
        <div className="relative">
          <LoadingOverlay show={overlayShow} label={t("shopFloor.loadingData")} />
          <AvailableWorkOrdersCard
            resursId={m.resursiId}
            machine={m}
            startPending={startM.isPending}
            onStart={(wo, startTimeIso) =>
              startM.mutate({
                woId: wo.id,
                isResume: wo.statusNaloga === "Pauziran",
                brojNaloga: wo.brojNaloga,
                sifraArtikla: wo.sifraArtikla,
                artikalNaziv: wo.artikalNaziv,
                planiranaKolicina: wo.planiranaKolicina,
                statusNaloga: wo.statusNaloga,
                startTimeIso,
              })
            }
          />
        </div>
      )}



      {!selected && !isLoading && machines.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          {t("shopFloor.noMachines")}
        </div>
      )}

      {isLoading && !data && (
        <div className="space-y-3">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      )}

      {isError && !data && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm flex items-center justify-between gap-3">
          <div className="text-destructive">
            {t("common.loadError")}: {(error as Error)?.message ?? "—"}
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`size-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            {t("common.retry")}
          </Button>
        </div>
      )}

      {m?.radniNalogId && perms?.viewHistory && (
        <div className="mt-6 rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-base font-semibold">{t("shopFloor.history")}</h2>
          </div>
          <HistoryList key={m.radniNalogId} items={history.data?.items || []} loading={history.isLoading} />
        </div>
      )}

      <WorkOrderDetailsDialog
        open={detailsOpen && !!m?.brojNaloga}
        onOpenChange={setDetailsOpen}
        m={m ?? null}
      />

      {m && (
        <StartWorkOrderDialog
          open={startOpen}
          onOpenChange={setStartOpen}
          resursId={m.resursiId}
          title={m.nazivLinije}
          pending={startM.isPending}
          onSubmit={(args) => startM.mutate(args)}
        />
      )}



      {m && (
        <DowntimeModal
          open={downtimeOpen}
          onOpenChange={setDowntimeOpen}
          monitoringId={m.monitoringId}
          userId={user?.id || ""}
          radniNalogId={m.radniNalogId}
          resursId={m.resursiId}
        />
      )}

      {m?.radniNalogId && (
        <InspectionModal
          open={inspectionOpen}
          onOpenChange={setInspectionOpen}
          radniNalogId={m.radniNalogId}
          userId={user?.id || ""}
          brojNaloga={m.brojNaloga}
          monitoringId={m.monitoringId}
          resursId={m.resursiId}
        />
      )}



      {m?.radniNalogId && (
        <PauseConfirmDialog
          open={pauseOpen}
          onOpenChange={setPauseOpen}
          brojNaloga={m.brojNaloga}
          onConfirm={(komentar) =>
            pauseM.mutate({ radniNalogId: (m.radniNalogId ?? ""), resursId: m.resursiId, userId: (user?.id ?? ""), komentar })
          }
          pending={pauseM.isPending}
        />
      )}

      {m?.radniNalogId && (
        <StopWithBatchDialog
          open={stopOpen}
          onOpenChange={setStopOpen}
          brojNaloga={m.brojNaloga}
          onConfirm={(payload) =>
            stopM.mutate({
              radniNalogId: (m.radniNalogId ?? ""),
              resursId: m.resursiId,
              userId: (user?.id ?? ""),
              ...payload,
            })
          }
          pending={stopM.isPending}
        />
      )}

      {m?.radniNalogId && (
        <ScrapDialog
          open={scrapOpen}
          onOpenChange={setScrapOpen}
          onConfirm={(payload) =>
            scrapM.mutate({
              radniNalogId: (m.radniNalogId ?? ""),
              resursId: m.resursiId,
              userId: (user?.id ?? ""),
              ...payload,
            })
          }
          pending={scrapM.isPending}
        />
      )}
    </div>
  );
}

function StatusDot({ running }: { running: boolean }) {
  return (
    <span
      className="inline-block size-2.5 rounded-full shrink-0"
      style={{ background: running ? "var(--color-status-running)" : "var(--color-status-downtime)" }}
    />
  );
}

function Kpi({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-md bg-secondary p-2 sm:p-3 text-center min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className="text-base sm:text-xl md:text-2xl font-semibold tabular-nums whitespace-nowrap"
        style={accent ? { color: accent } : undefined}
      >
        {formatNumber(value)}
      </div>
    </div>
  );
}

function ProductionBar({ good, scrap, target }: { good: number; scrap: number; target: number }) {
  const { t } = useTranslation();
  const goodPct = target > 0 ? Math.min(100, (good / target) * 100) : 0;
  const scrapPct = good > 0 ? Math.min(100, (scrap / good) * 100) : 0;
  return (
    <div className="space-y-3">
      <BarRow label={t("shopFloor.goodProduced")} pct={goodPct} color="var(--color-status-running)" />
      <BarRow label={t("shopFloor.scrap")} pct={scrapPct} color="var(--color-status-downtime)" thin />
    </div>
  );
}

function BarRow({ label, pct, color, thin }: { label: string; pct: number; color: string; thin?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{pct.toFixed(1)}%</span>
      </div>
      <div className={`${thin ? "h-1.5" : "h-2.5"} w-full rounded-full bg-secondary overflow-hidden`}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function BigActionButton({
  icon, label, onClick, disabled, tone,
}: {
  icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; tone?: "destructive" | "warning";
}) {
  const base = "h-20 rounded-lg border border-border flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40";
  const toneCls =
    tone === "destructive"
      ? "bg-destructive/20 hover:bg-destructive/30"
      : "bg-card hover:bg-accent";
  const iconColor =
    tone === "destructive" ? "var(--color-destructive)" :
    tone === "warning" ? "var(--color-status-nosignal)" : undefined;
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${toneCls}`}>
      <span style={iconColor ? { color: iconColor } : undefined}>{icon}</span>
      <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
    </button>
  );
}

function HistoryList({ items, loading }: { items: PromenaRow[]; loading: boolean }) {
  const { t } = useTranslation();
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(0);
  if (loading) return <div className="p-4 text-sm text-muted-foreground">{t("common.loadingDots")}</div>;
  const VISIBLE_TIPS: PromenaRow["tip"][] = ["start", "pauza", "nastavak", "stop", "skart"];
  const filtered = items.filter((it) => VISIBLE_TIPS.includes(it.tip));
  if (filtered.length === 0) return <div className="p-6 text-sm text-muted-foreground text-center">{t("shopFloor.noChanges")}</div>;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const slice = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  return (
    <div>
      <div className="divide-y divide-border">
        {slice.map((it) => (
          <div key={it.id} className="px-3 sm:px-4 py-2.5 text-sm grid grid-cols-[5.5rem_1fr] sm:grid-cols-[7.5rem_1fr_minmax(7rem,auto)] gap-3 items-start">
            <div className="text-xs text-muted-foreground font-mono leading-tight whitespace-pre-line">
              {fmtDateTime(it.createdAt)}
            </div>
            <div className="min-w-0">
              <div className="font-medium break-words" style={{ color: tipColor(it.tip) }}>{it.opis}</div>
            </div>
            <div className="col-start-2 sm:col-start-auto text-xs text-muted-foreground break-words sm:text-right">
              {it.operator || ""}
            </div>
          </div>
        ))}
      </div>
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {t("shopFloor.pageInfo", { page: safePage + 1, total: totalPages, count: filtered.length })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function tipColor(t: PromenaRow["tip"]): string {
  switch (t) {
    case "start":
    case "nastavak":
    case "definisanje":
    case "podela":
      return "var(--color-status-running)";
    case "pauza":
      return "var(--color-status-nosignal)";
    case "stop":
      return "var(--color-status-off)";
    case "skart":
      return "var(--color-status-downtime)";
    default:
      return "var(--color-foreground)";
  }
}

function fmtDateTime(s?: string): string {
  if (!s) return "";
  return formatDateTime(s).replace(" ", "\n");
}


// ============= Dialogs =============


function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const variant = status === "Pauziran" ? "secondary" : "default";
  const cls = status === "Pauziran"
    ? "bg-[color:var(--color-status-nosignal)]/20 text-foreground"
    : "bg-[color:var(--color-status-running)]/20 text-foreground";
  return <Badge variant={variant} className={cls}>{status}</Badge>;
}

function PauseConfirmDialog({
  open, onOpenChange, brojNaloga, onConfirm, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brojNaloga?: string;
  onConfirm: (komentar?: string) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [komentar, setKomentar] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setKomentar(""); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogs.pause.title")}</DialogTitle>
          <DialogDescription>
            {brojNaloga
              ? <Trans i18nKey="dialogs.pause.descWith" values={{ broj: brojNaloga }} components={{ strong: <strong /> }} />
              : t("dialogs.pause.descNone")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="pause-komentar">{t("dialogs.commentLabel")}</Label>
          <Textarea
            id="pause-komentar"
            value={komentar}
            onChange={(e) => setKomentar(e.target.value)}
            rows={3}
            placeholder={t("dialogs.pause.commentPh")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="touch" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <AsyncButton
            size="touch"
            pending={pending}
            pendingLabel={t("dialogs.pause.btnPending")}
            onClick={() => onConfirm(komentar.trim() || undefined)}
            className="min-w-28"
          >
            {t("dialogs.pause.btn")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface StopPayload {
  dobroProizvedeno: number;
  kolicinaSkarta?: number;
  grupaSkartaId?: string;
  tipSkartaId?: string;
  komentar?: string;
}

function StopWithBatchDialog({
  open, onOpenChange, brojNaloga, onConfirm, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brojNaloga?: string;
  onConfirm: (payload: StopPayload) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [dobro, setDobro] = useState<string>("0");
  const [skart, setSkart] = useState<string>("");
  const [grupa, setGrupa] = useState<string>("");
  const [tip, setTip] = useState<string>("");
  const [komentar, setKomentar] = useState<string>("");

  const skartNum = Number(skart);
  const hasSkart = !!skart && skartNum > 0;
  const dobroNum = Number(dobro);
  const validDobro = !isNaN(dobroNum) && dobroNum >= 0;
  const valid = validDobro && (!hasSkart || (!!grupa && !!tip));

  const reset = () => { setDobro("0"); setSkart(""); setGrupa(""); setTip(""); setKomentar(""); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialogs.stop.title")}</DialogTitle>
          <DialogDescription>
            {brojNaloga
              ? <Trans i18nKey="dialogs.stop.descWithLong" values={{ broj: brojNaloga }} components={{ strong: <strong /> }} />
              : t("dialogs.stop.descNoneLong")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stop-dobro" className="text-base">{t("dialogs.stop.goodProduced")}</Label>
            <Input
              id="stop-dobro"
              type="number"
              inputMode="numeric"
              min={0}
              value={dobro}
              onChange={(e) => setDobro(e.target.value)}
              className="h-14 text-2xl font-semibold text-center"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="stop-skart">{t("dialogs.stop.scrapOpt")}</Label>
            <Input
              id="stop-skart"
              type="number"
              inputMode="numeric"
              min={0}
              value={skart}
              onChange={(e) => setSkart(e.target.value)}
              className="h-12"
              placeholder="0"
            />
          </div>

          {hasSkart && (
            <ScrapGroupTypeSelectors grupa={grupa} setGrupa={setGrupa} tip={tip} setTip={setTip} />
          )}

          <div className="space-y-2">
            <Label htmlFor="stop-komentar">{t("dialogs.commentLabel")}</Label>
            <Textarea
              id="stop-komentar"
              value={komentar}
              onChange={(e) => setKomentar(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="touch" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <AsyncButton
            size="touch"
            pending={pending}
            pendingLabel={t("dialogs.stop.btnPending")}
            onClick={() => onConfirm({
              dobroProizvedeno: dobroNum,
              kolicinaSkarta: hasSkart ? skartNum : undefined,
              grupaSkartaId: hasSkart ? grupa : undefined,
              tipSkartaId: hasSkart ? tip : undefined,
              komentar: komentar.trim() || undefined,
            })}
            disabled={!valid}
            className="min-w-28 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("dialogs.stop.btn")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ScrapPayload {
  kolicinaSkarta: number;
  grupaSkartaId: string;
  tipSkartaId: string;
  komentar?: string;
}

function ScrapDialog({
  open, onOpenChange, onConfirm, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (payload: ScrapPayload) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [skart, setSkart] = useState<string>("");
  const [grupa, setGrupa] = useState<string>("");
  const [tip, setTip] = useState<string>("");
  const [komentar, setKomentar] = useState<string>("");

  const skartNum = Number(skart);
  const valid = !!skart && skartNum > 0 && !!grupa && !!tip;

  const reset = () => { setSkart(""); setGrupa(""); setTip(""); setKomentar(""); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialogs.scrap.title")}</DialogTitle>
          <DialogDescription>{t("dialogs.scrap.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scrap-kol" className="text-base">{t("dialogs.scrap.qty")}</Label>
            <Input
              id="scrap-kol"
              type="number"
              inputMode="numeric"
              min={1}
              value={skart}
              onChange={(e) => setSkart(e.target.value)}
              className="h-14 text-2xl font-semibold text-center"
              placeholder="0"
            />
          </div>

          <ScrapGroupTypeSelectors grupa={grupa} setGrupa={setGrupa} tip={tip} setTip={setTip} />

          <div className="space-y-2">
            <Label htmlFor="scrap-komentar">{t("dialogs.commentLabel")}</Label>
            <Textarea
              id="scrap-komentar"
              value={komentar}
              onChange={(e) => setKomentar(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="touch" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <AsyncButton
            size="touch"
            pending={pending}
            pendingLabel={t("dialogs.scrap.btnPending")}
            onClick={() => onConfirm({
              kolicinaSkarta: skartNum,
              grupaSkartaId: grupa,
              tipSkartaId: tip,
              komentar: komentar.trim() || undefined,
            })}
            disabled={!valid}
            className="min-w-28"
          >
            {t("dialogs.scrap.btn")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScrapGroupTypeSelectors({
  grupa, setGrupa, tip, setTip,
}: {
  grupa: string; setGrupa: (v: string) => void; tip: string; setTip: (v: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const callDropdown = useServerFn(getDropdownDataFn);
  const q = useQuery({
    queryKey: ["dropdown-data"],
    queryFn: () => callDropdown(),
    staleTime: 10 * 60_000,
  });
  const grupe = q.data?.grupe || [];
  const tipoviAll = q.data?.tipovi || [];
  const tipovi = grupa ? tipoviAll.filter((x) => x.grupaId === grupa) : [];

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="space-y-2">
        <Label>{t("dialogs.scrap.groupLabel")}</Label>
        <Select
          value={grupa}
          onValueChange={(v) => { setGrupa(v); setTip(""); }}
          disabled={q.isLoading}
        >
          <SelectTrigger className="h-12">
            <SelectValue placeholder={q.isLoading ? t("common.loadingDots") : t("dialogs.scrap.pickGroup")} />
          </SelectTrigger>
          <SelectContent>
            {grupe.map((g) => (
              <SelectItem key={g.id} value={g.id}>{pickName(g, i18n.language)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{t("dialogs.scrap.typeLabel")}</Label>
        <Select value={tip} onValueChange={setTip} disabled={!grupa || tipovi.length === 0}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder={!grupa ? t("dialogs.scrap.pickGroupFirst") : tipovi.length === 0 ? t("dialogs.scrap.noTypesForGroup") : t("dialogs.scrap.pickType")} />
          </SelectTrigger>
          <SelectContent>
            {tipovi.map((x) => (
              <SelectItem key={x.id} value={x.id}>{pickName(x, i18n.language)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ============= Downtime info card =============
function DowntimeInfoCard({ m }: { m: MachineDashboardRow }) {
  const { t: tDt } = useTranslation();
  return (
    <div className="mb-4 rounded-xl border border-border bg-card overflow-hidden border-l-4" style={{ borderLeftColor: "var(--color-status-downtime)" }}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_auto] gap-3 md:gap-4 items-center p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-10 rounded-md bg-secondary flex items-center justify-center shrink-0">
            <Factory className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold truncate">{m.nazivLinije}</div>
            <Badge
              className="mt-1 text-xs"
              style={{ background: "var(--color-status-downtime)", color: "var(--color-destructive-foreground, white)" }}
            >
              <AlertOctagon className="size-3" /> {tDt("monitoring.downtime")}
            </Badge>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{tDt("monitoring.downtime")}</div>
          <div className="font-semibold truncate">{m.grupaZastoja || "—"}</div>
          <div className="text-xs text-muted-foreground truncate">{m.tipZastojaDetail || ""}</div>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{tDt("monitoring.duration")}</div>
          <div className="font-semibold">{m.trajanjeZastoja || "—"}</div>
        </div>
      </div>
    </div>
  );
}

// ============= Available work orders card (inline list with per-row Start) =============
function AvailableWorkOrdersCard({
  resursId, machine, startPending, onStart,
}: {
  resursId: string;
  machine: MachineDashboardRow;
  startPending: boolean;
  onStart: (wo: AvailableWorkOrder, startTimeIso: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const callAvail = useServerFn(getAvailableWorkOrdersFn);
  const [confirmWO, setConfirmWO] = useState<AvailableWorkOrder | null>(null);
  const [detailsWO, setDetailsWO] = useState<AvailableWorkOrder | null>(null);
  const [startInput, setStartInput] = useState<string>("");

  const q = useQuery({
    queryKey: ["available-wo", resursId],
    queryFn: () => callAvail({ data: { resursId } }),
    enabled: !!resursId,
    refetchInterval: 60_000,
  });

  const items: AvailableWorkOrder[] = q.data?.items || [];

  // Zatvori potvrdu i resetuj input čim mutacija u parentu padne na isPending=false
  useEffect(() => {
    if (!startPending && confirmWO) {
      // ako je startM uspeo, parent invalidira "available-wo" → confirm dialog ostaje prazan
    }
  }, [startPending, confirmWO]);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 border-b border-border my-0 py-[16px] gap-0">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-primary" />
          <h2 className="text-base font-semibold">{t("shopFloor.availableWorkOrders")}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={() => q.refetch()} disabled={q.isFetching} title={t("shopFloor.refreshTitle")}>
          <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="px-4 pt-3">
        <div className="border-b-2 border-primary pb-2 inline-flex items-center gap-2 text-primary text-sm font-medium">
          <Play className="size-4" />
          {t("shopFloor.startList", { count: items.length })}
        </div>
      </div>

      {q.isLoading ? (
        <div className="p-6 text-sm text-muted-foreground text-center">{t("common.loadingDots")}</div>
      ) : items.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground text-center">{t("shopFloor.noAvailableForMachine")}</div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((wo) => (
            <li key={wo.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setDetailsWO(wo)}
                className="min-w-0 flex-1 text-left cursor-pointer hover:opacity-80 transition-opacity bg-transparent border-0 p-0"
                title={t("shopFloor.showWoDetails")}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold truncate">{wo.brojNaloga}</span>
                  <StatusBadge status={wo.statusNaloga} />
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {wo.sifraArtikla && <span>{wo.sifraArtikla} | </span>}
                  {wo.artikalNaziv}
                </div>
                {(wo.narucilac || wo.planiranaKolicina != null) && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {wo.narucilac && <span className="mr-2">{wo.narucilac}</span>}
                    {wo.planiranaKolicina != null && <span>{t("shopFloor.qtyKom", { count: wo.planiranaKolicina })}</span>}
                  </div>
                )}
              </button>
              <Button
                onClick={() => setConfirmWO(wo)}
                disabled={startPending}
                className="shrink-0"
              >
                <Play className="size-4" />
                {wo.statusNaloga === "Pauziran" ? t("shopFloor.resume") : t("shopFloor.start")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <WorkOrderDetailsDialog
        open={!!detailsWO}
        onOpenChange={(v) => !v && setDetailsWO(null)}
        m={detailsWO ? {
          ...machine,
          radniNalogId: detailsWO.id,
          brojNaloga: detailsWO.brojNaloga,
          sifraArtikla: detailsWO.sifraArtikla,
          artikalNaziv: detailsWO.artikalNaziv,
          narucilac: detailsWO.narucilac,
          statusNaloga: detailsWO.statusNaloga,
          planiranaKolicina: detailsWO.planiranaKolicina,
          alat: undefined,
          ispravnoProizvedeno: undefined,
          dobroProizvedeno: undefined,
          skart: undefined,
          planiranStart: undefined,
          planiranKraj: undefined,
          brojKaviteta: undefined,
          masaKomadaG: undefined,
        } : null}
        defaultTab="promene"
      />

      <Dialog open={!!confirmWO} onOpenChange={(v) => { if (!v) { setConfirmWO(null); setStartInput(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmWO?.statusNaloga === "Pauziran" ? t("dialogs.start.confirmResumeTitle") : t("dialogs.start.confirmRunTitle")}</DialogTitle>
            <DialogDescription>
              {confirmWO ? (
                <Trans
                  i18nKey={confirmWO.statusNaloga === "Pauziran" ? "dialogs.start.confirmResumeDesc" : "dialogs.start.confirmRunDesc"}
                  values={{ broj: confirmWO.brojNaloga }}
                  components={{ strong: <strong /> }}
                />
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {confirmWO && confirmWO.statusNaloga !== "Pauziran" && (
            <div className="space-y-2">
              <Label>{t("dialogs.start.startOptional")}</Label>
              <Input type="datetime-local" value={startInput} onChange={(e) => setStartInput(e.target.value)} className="h-11" />
              <p className="text-xs text-muted-foreground">{t("dialogs.start.leaveEmpty")}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="touch" onClick={() => { setConfirmWO(null); setStartInput(""); }} disabled={startPending}>{t("common.cancel")}</Button>
            <AsyncButton
              size="touch"
              pending={startPending}
              pendingLabel={confirmWO?.statusNaloga === "Pauziran" ? t("dialogs.start.resumingLabel") : t("dialogs.start.runningLabel")}
              onClick={() => {
                if (!confirmWO) return;
                const iso =
                  confirmWO.statusNaloga !== "Pauziran" && startInput
                    ? new Date(startInput).toISOString()
                    : undefined;
                onStart(confirmWO, iso);
                setConfirmWO(null);
                setStartInput("");
              }}
              className="min-w-28"
            >
              {confirmWO?.statusNaloga === "Pauziran" ? t("dialogs.start.resume") : t("dialogs.start.run")}
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


