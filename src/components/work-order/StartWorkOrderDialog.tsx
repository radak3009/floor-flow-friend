import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/ui/async-button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

import {
  getAvailableWorkOrdersFn,
  type AvailableWorkOrder,
} from "@/lib/api/workorder.functions";

export interface StartWorkOrderSubmitArgs {
  woId: string;
  isResume: boolean;
  brojNaloga?: string;
  sifraArtikla?: string;
  artikalNaziv?: string;
  planiranaKolicina?: number;
  statusNaloga?: string;
  /** ISO datetime za "start" polje; undefined za auto */
  startTimeIso?: string;
}

export interface StartWorkOrderDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resursId?: string;
  /** Kept for back-compat; not used internally now. */
  userId?: string;
  title?: string;
  /** Parent vlasnik mutacije: kontroliše spinner. */
  pending: boolean;
  /** Parent okida mutaciju (enqueue/server fn) i zatvara dialog u onSuccess. */
  onSubmit: (args: StartWorkOrderSubmitArgs) => void;
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const cls = status === "Pauziran"
    ? "bg-[color:var(--color-status-nosignal)]/20 text-foreground"
    : "bg-[color:var(--color-status-running)]/20 text-foreground";
  return <Badge className={cls}>{status}</Badge>;
}

export default function StartWorkOrderDialog({
  open,
  onOpenChange,
  resursId,
  title,
  pending,
  onSubmit,
}: StartWorkOrderDialogProps) {
  const callAvail = useServerFn(getAvailableWorkOrdersFn);
  const [picked, setPicked] = useState<string>("");
  const [startInput, setStartInput] = useState<string>("");

  // Reset lokalnog stanja kada se dialog zatvori
  useEffect(() => {
    if (!open) {
      setPicked("");
      setStartInput("");
    }
  }, [open]);

  const q = useQuery({
    queryKey: ["available-wo", resursId],
    queryFn: () => callAvail({ data: { resursId: resursId! } }),
    enabled: open && !!resursId,
  });

  const items: AvailableWorkOrder[] = q.data?.items || [];
  const selectedWO = items.find((i) => i.id === picked);
  const isPaused = selectedWO?.statusNaloga === "Pauziran";

  function handleSubmit() {
    if (!selectedWO) return;
    const isResume = selectedWO.statusNaloga === "Pauziran";
    onSubmit({
      woId: selectedWO.id,
      isResume,
      brojNaloga: selectedWO.brojNaloga,
      sifraArtikla: selectedWO.sifraArtikla,
      artikalNaziv: selectedWO.artikalNaziv,
      planiranaKolicina: selectedWO.planiranaKolicina,
      statusNaloga: selectedWO.statusNaloga,
      startTimeIso: !isResume && startInput ? new Date(startInput).toISOString() : undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {title ? `Pokreni radni nalog — ${title}` : "Pokretanje radnog naloga"}
          </DialogTitle>
          <DialogDescription>Izaberite radni nalog za ovu mašinu.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Radni nalog</Label>
          {q.isLoading ? (
            <div className="text-sm text-muted-foreground">Učitavanje...</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nema dostupnih radnih naloga za ovu mašinu.</div>
          ) : (
            <Select value={picked} onValueChange={setPicked}>
              <SelectTrigger className="h-12 text-base">
                <SelectValue placeholder="Izaberite radni nalog">
                  {selectedWO && (
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{selectedWO.brojNaloga}</span>
                      <StatusBadge status={selectedWO.statusNaloga} />
                    </span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {items.map((it) => (
                  <SelectItem key={it.id} value={it.id} className="h-12">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{it.brojNaloga}</span>
                      {it.sifraArtikla && <span className="text-muted-foreground text-xs">{it.sifraArtikla}</span>}
                      <StatusBadge status={it.statusNaloga} />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedWO && (
            <div className="text-xs text-muted-foreground mt-1">
              {selectedWO.artikalNaziv}
              {selectedWO.planiranaKolicina != null &&
                ` · Planirano: ${selectedWO.planiranaKolicina.toLocaleString("sr")}`}
            </div>
          )}
        </div>
        {!isPaused && (
          <div className="space-y-2">
            <Label>Start (opciono)</Label>
            <Input type="datetime-local" value={startInput} onChange={(e) => setStartInput(e.target.value)} className="h-11" />
            <p className="text-xs text-muted-foreground">Ostavite prazno da se vreme postavi automatski.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="touch" onClick={() => onOpenChange(false)} disabled={pending}>
            Otkaži
          </Button>
          <AsyncButton
            size="touch"
            pending={pending}
            pendingLabel={isPaused ? "Nastavljam..." : "Pokrećem..."}
            onClick={handleSubmit}
            disabled={!picked}
            className="min-w-28"
          >
            {isPaused ? "Nastavi" : "Pokreni"}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
