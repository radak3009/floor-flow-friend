import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import AsyncButton from "@/components/ui/async-button";
import { getWorkOrderHistoryFn, pomeriStartFn, type PromenaRow } from "@/lib/api/workorder.functions";
import { patchDashboardRow, rollback, invalidateAfterAction } from "@/lib/query/invalidate";
import { getInspectionsForWorkOrderFn, type InspekcijaRow } from "@/lib/api/inspection.functions";
import type { MachineDashboardRow } from "@/lib/api/dashboard.functions";
import CommentThread from "@/components/comments/CommentThread";
import ScrapDeleteButton from "@/components/work-order/ScrapDeleteButton";
import { useAuth } from "@/context/AuthContext";


function fmtDate(s?: string): string | undefined {
  if (!s) return undefined;
  try { return new Date(s).toLocaleDateString("sr-RS"); } catch { return s; }
}
function fmtDateTime(s?: string): string {
  if (!s) return "";
  try {
    const d = new Date(s);
    return `${d.toLocaleDateString("sr-RS")} ${d.toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit" })}`;
  } catch { return s; }
}
function fmtDateTimeParts(s?: string): { date: string; time: string } {
  if (!s) return { date: "", time: "" };
  try {
    const d = new Date(s);
    return {
      date: d.toLocaleDateString("sr-RS"),
      time: d.toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit" }),
    };
  } catch { return { date: s, time: "" }; }
}

function DetailRow({ label, value, tooltip }: { label: string; value?: string; tooltip?: boolean }) {
  const display = value || "—";
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
      <div className="text-muted-foreground">{label}</div>
      {tooltip && value ? (
        <TooltipProvider delayDuration={500}>
          <Tooltip open={open} onOpenChange={setOpen}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen((v: boolean) => !v); }}
                className="font-medium text-right truncate min-w-0 cursor-pointer bg-transparent border-0 p-0 text-inherit"
              >
                {display}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs break-words">
              <p>{value}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <div className="font-medium text-right truncate">{display}</div>
      )}
    </div>
  );
}

function PromeneList({ items, canDelete, userId, radniNalogId }: { items: PromenaRow[]; canDelete?: boolean; userId?: string; radniNalogId?: string }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {items.map((it) => (
        <li key={it.id} className="px-3 py-2.5 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium break-words">{it.opis}</div>
              {it.operator && <div className="text-xs text-muted-foreground mt-0.5 break-words">{it.operator}</div>}
            </div>
            <div className="flex items-start gap-1 shrink-0">
              <div className="text-xs text-muted-foreground text-right leading-tight">
                <div>{fmtDateTimeParts(it.createdAt).date}</div>
                <div>{fmtDateTimeParts(it.createdAt).time}</div>
              </div>
              {canDelete && it.tip === "skart" && userId && !it.id.startsWith("__optimistic:") && (
                <ScrapDeleteButton promenaId={it.id} userId={userId} radniNalogId={radniNalogId} />
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}


function InspekcijaList({ items }: { items: InspekcijaRow[] }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {items.map((it) => (
        <li key={it.id} className="px-3 py-2.5 text-sm space-y-1">
          <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
            <span className="font-medium min-w-0 break-words">
              Komad #{it.brojIspitanogKomada ?? "—"}
              {it.ukupnaOcena && <span className="ml-2 text-xs text-muted-foreground">({it.ukupnaOcena})</span>}
            </span>
            <span className="text-xs text-muted-foreground shrink-0 whitespace-pre-line text-right">{fmtDateTime(it.createdAt)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {it.vizuelno && <div>Vizuelno: <span className="text-foreground">{it.vizuelno}</span></div>}
            {it.funkcionalno && <div>Funkcionalno: <span className="text-foreground">{it.funkcionalno}</span></div>}
            {it.integralniKvalitet && <div>Integralni: <span className="text-foreground">{it.integralniKvalitet}</span></div>}
            {it.odstupanjeOdInstrukcija && <div>Odstupanje: <span className="text-foreground">{it.odstupanjeOdInstrukcija}</span></div>}
            {it.masaKomadaG != null && <div>Masa (g): <span className="text-foreground">{it.masaKomadaG.toLocaleString("sr", { maximumFractionDigits: 3 })}</span></div>}
            {it.kolicinaNeusaglasenih != null && <div>Neusaglašeno: <span className="text-foreground">{it.kolicinaNeusaglasenih}</span></div>}
          </div>
          {it.uzrokOdstupanja && <div className="text-xs"><span className="text-muted-foreground">Uzrok: </span>{it.uzrokOdstupanja}</div>}
          {it.komentar && <div className="text-xs"><span className="text-muted-foreground">Komentar: </span>{it.komentar}</div>}
          {it.operator && <div className="text-xs text-muted-foreground break-words">{it.operator}</div>}
        </li>
      ))}
    </ul>
  );
}

type WoTab = "skart" | "inspekcija" | "promene" | "chat";

export function WorkOrderDetailsContent({ m, defaultTab = "skart" }: { m: MachineDashboardRow; defaultTab?: WoTab }) {
  const { user } = useAuth();
  const callHistory = useServerFn(getWorkOrderHistoryFn);
  const callInspections = useServerFn(getInspectionsForWorkOrderFn);
  const canDeleteScrap = !!user?.permissions.deleteScrap;
  const historyQ = useQuery({

    queryKey: ["wo-history", m.radniNalogId],
    queryFn: () => callHistory({ data: { radniNalogId: m.radniNalogId! } }),
    enabled: !!m.radniNalogId,
    staleTime: 30_000,
  });
  const inspQ = useQuery({
    queryKey: ["wo-inspections", m.radniNalogId],
    queryFn: () => callInspections({ data: { radniNalogId: m.radniNalogId! } }),
    enabled: !!m.radniNalogId,
    staleTime: 30_000,
  });
  const items = historyQ.data?.items || [];
  const promene = items.filter((i) => i.tip === "start" || i.tip === "pauza" || i.tip === "nastavak" || i.tip === "stop");
  const skartItems = items.filter((i) => i.tip === "skart");
  const inspekcije = inspQ.data?.items || [];

  const qc = useQueryClient();
  const callPomeriStart = useServerFn(pomeriStartFn);
  const [pomeriOpen, setPomeriOpen] = useState(false);
  const [movingFrom, setMovingFrom] = useState<string | null>(null);
  const pomeriMut = useMutation({
    mutationFn: async () => callPomeriStart({
      data: {
        radniNalogId: m.radniNalogId!,
        monitoringId: m.monitoringId,
        prevPoceo: m.vremeOtvaranjaNaloga,
      },
    }),
    onMutate: async () => {
      const snap = await patchDashboardRow(qc, m.monitoringId, (row) => ({
        ...row,
        vremeOtvaranjaNaloga: undefined,
      }));
      return { snap };
    },
    onError: (e: any, _vars, ctx) => {
      rollback(qc, ctx?.snap ?? null);
      toast.error(e?.message || "Greška pri pomeranju starta");
    },
    onSuccess: () => {
      toast.success("Start pomeren");
      setPomeriOpen(false);
      setMovingFrom(m.vremeOtvaranjaNaloga ?? "");
    },
    onSettled: () => {
      invalidateAfterAction(qc, { monitoringId: m.monitoringId, radniNalogId: m.radniNalogId });
    },
  });
  // Clear "moving" indicator once Airtable reports a new value different from the previous one.
  useEffect(() => {
    if (movingFrom === null) return;
    if (m.vremeOtvaranjaNaloga && m.vremeOtvaranjaNaloga !== movingFrom) {
      setMovingFrom(null);
    }
  }, [m.vremeOtvaranjaNaloga, movingFrom]);
  const isMoving = pomeriMut.isPending || movingFrom !== null;
  const canResetStart = !!user?.permissions.resetStart && !!m.radniNalogId;

  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-lg border border-border">
        <DetailRow label="Radni nalog" value={m.brojNaloga} />
        <DetailRow label="Mašina / Linija" value={m.nazivLinije} />
        <DetailRow label="Alat" value={m.alat} tooltip />
        <DetailRow label="Artikal" value={m.artikalNaziv} tooltip />
        <DetailRow label="Naručilac" value={m.narucilac} tooltip />
        <DetailRow label="Šifra artikla" value={m.sifraArtikla} />
        <DetailRow label="Planiran start" value={fmtDate(m.planiranStart)} />
        <DetailRow label="Planiran kraj" value={fmtDate(m.planiranKraj)} />
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
          <div className="text-muted-foreground flex items-center gap-2">
            <span>Počeo</span>
            {canResetStart && (
              <AsyncButton
                size="sm"
                pending={pomeriMut.isPending}
                onClick={() => setPomeriOpen(true)}
              >
                Pomeri start
              </AsyncButton>
            )}
          </div>
          <div className="font-medium text-right truncate">
            {isMoving ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground italic">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Premešta se…
              </span>
            ) : (
              m.vremeOtvaranjaNaloga ? fmtDateTime(m.vremeOtvaranjaNaloga) : "—"
            )}
          </div>
        </div>
        <DetailRow label="Planirana količina" value={m.planiranaKolicina != null ? m.planiranaKolicina.toLocaleString("sr") : undefined} />
        <DetailRow label="Proizvedeno" value={(m.dobroProizvedeno ?? m.ispravnoProizvedeno) != null ? (m.dobroProizvedeno ?? m.ispravnoProizvedeno ?? 0).toLocaleString("sr") : undefined} />
        <DetailRow label="Škart" value={m.skart != null ? m.skart.toLocaleString("sr") : undefined} />
        <DetailRow label="Gnezda (kaviteta)" value={m.brojKaviteta != null ? String(m.brojKaviteta) : undefined} />
        <DetailRow label="Masa/kom (g)" value={m.masaKomadaG != null ? m.masaKomadaG.toLocaleString("sr", { maximumFractionDigits: 3 }) : undefined} />
      </div>

      <AlertDialog open={pomeriOpen} onOpenChange={setPomeriOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pomeri start naloga</AlertDialogTitle>
            <AlertDialogDescription>
              Ova akcija postaviće početak naloga iza poslednjeg zatvorenog posla!
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pomeriMut.isPending}>Otkaži</AlertDialogCancel>
            <AlertDialogAction
              disabled={pomeriMut.isPending}
              onClick={(e) => { e.preventDefault(); pomeriMut.mutate(); }}
            >
              Potvrdi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <Tabs defaultValue={defaultTab}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="skart" className="text-[11px] sm:text-sm px-1 sm:px-3"><span className="sm:hidden">Škart ({skartItems.length})</span><span className="hidden sm:inline">Škart ({skartItems.length})</span></TabsTrigger>
          <TabsTrigger value="inspekcija" className="text-[11px] sm:text-sm px-1 sm:px-3"><span className="sm:hidden">Insp. ({inspekcije.length})</span><span className="hidden sm:inline">Inspekcija ({inspekcije.length})</span></TabsTrigger>
          <TabsTrigger value="promene" className="text-[11px] sm:text-sm px-1 sm:px-3"><span className="sm:hidden">Prom. ({promene.length})</span><span className="hidden sm:inline">Promene ({promene.length})</span></TabsTrigger>
          <TabsTrigger value="chat" className="text-[11px] sm:text-sm px-1 sm:px-3">Chat</TabsTrigger>
        </TabsList>
        <TabsContent value="skart">
          {skartItems.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Nema unosa škarta</div>
          ) : <PromeneList items={skartItems} canDelete={canDeleteScrap} userId={user?.id} radniNalogId={m.radniNalogId} />}
        </TabsContent>
        <TabsContent value="inspekcija">
          {inspQ.isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Učitavanje...</div>
          ) : inspekcije.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Nema unosa inspekcije</div>
          ) : <InspekcijaList items={inspekcije} />}
        </TabsContent>
        <TabsContent value="promene">
          {historyQ.isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Učitavanje...</div>
          ) : promene.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Nema promena naloga</div>
          ) : <PromeneList items={promene} />}
        </TabsContent>
        <TabsContent value="chat">
          {m.radniNalogId ? (
            <CommentThread entityType="work_order" entityId={m.radniNalogId} entityLabel={m.brojNaloga || m.radniNalogId} />
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">Nalog nije aktivan.</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function WorkOrderDetailsDialog({
  open, onOpenChange, m, defaultTab,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  m: MachineDashboardRow | null;
  defaultTab?: WoTab;
}) {
  return (
    <Sheet open={open && !!m?.brojNaloga} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="px-0">
          <SheetTitle className="uppercase tracking-wide text-sm">Detalji o radnom nalogu</SheetTitle>
        </SheetHeader>
        {m && <WorkOrderDetailsContent m={m} defaultTab={defaultTab} />}
      </SheetContent>
    </Sheet>
  );
}

