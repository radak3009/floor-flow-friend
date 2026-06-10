import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/ui/async-button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getDropdownDataFn } from "@/lib/api/workorder.functions";
import { getActiveDowntimeFn } from "@/lib/api/downtime.functions";
import { enqueue } from "@/lib/offline/outbox";
import { toast } from "sonner";
import { invalidateAfterActionDelayed } from "@/lib/query/invalidate";
import { pickName } from "@/lib/i18n/format";
import { useTranslation } from "react-i18next";

function fmtDt(iso?: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("sr-RS", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  monitoringId: string;
  userId: string;
  radniNalogId?: string;
  resursId?: string;
  onSubmitted?: (info: { ongoing: boolean; queued: boolean; grupaNaziv?: string }) => void;
}

export default function DowntimeModal({ open, onOpenChange, monitoringId, userId, radniNalogId, resursId, onSubmitted }: Props) {
  const queryClient = useQueryClient();
  const callDropdown = useServerFn(getDropdownDataFn);
  const callActive = useServerFn(getActiveDowntimeFn);
  const { i18n } = useTranslation();
  const lang = i18n.language;

  const [grupaId, setGrupaId] = useState("");
  const [tipId, setTipId] = useState("");
  const [ongoing, setOngoing] = useState(true);
  const [komentar, setKomentar] = useState("");
  const [krajInput, setKrajInput] = useState("");

  const dd = useQuery({
    queryKey: ["dropdown-data"],
    queryFn: () => callDropdown(),
    staleTime: 10 * 60_000,
  });

  const active = useQuery({
    queryKey: ["active-downtime", monitoringId],
    queryFn: () => callActive({ data: { monitoringId } }),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setGrupaId(""); setTipId(""); setKomentar(""); setOngoing(true);
      setKrajInput(toLocalInput(new Date()));
    }
  }, [open]);

  const grupe = dd.data?.grupeZastoj || [];
  const tipoviAll = dd.data?.tipovi || [];
  const tipovi = useMemo(() => grupaId ? tipoviAll.filter((t) => t.grupaId === grupaId) : [], [grupaId, tipoviAll]);

  const noActive = active.isFetched && !active.data?.found;

  const m = useMutation({
    mutationFn: () => {
      const grupaNaziv = grupaId ? (() => { const g = grupe.find((x) => x.id === grupaId); return g ? pickName(g, lang) : undefined; })() : undefined;
      return enqueue(
        "logDowntime",
        ongoing ? "Definisanje zastoja" : "Podela zastoja",
        {
          monitoringId,
          userId,
          grupaId: grupaId || undefined,
          grupaNaziv,
          tipId: tipId || undefined,
          komentar: komentar.trim() || undefined,
          ongoing,
          kraj: !ongoing ? new Date(krajInput).toISOString() : undefined,
        },
      );
    },
    onSuccess: (res) => {
      const grupaNaziv = grupaId ? (() => { const g = grupe.find((x) => x.id === grupaId); return g ? pickName(g, lang) : undefined; })() : undefined;
      toast.success(res.queued
        ? "Sačuvano lokalno — biće poslato kad se konekcija vrati"
        : (ongoing ? "Zastoj definisan" : "Zastoj podeljen"));
      onSubmitted?.({ ongoing, queued: !!res.queued, grupaNaziv });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Greška"),
    onSettled: () => invalidateAfterActionDelayed(queryClient, { radniNalogId, monitoringId, resursId }),
  });

  const canSave = !noActive && !active.isLoading && (!!grupaId || !!komentar);

  const handleSave = () => {
    if (!ongoing) {
      const startIso = active.data?.start;
      if (!startIso) {
        toast.error("Nije pronađen početak aktivnog zastoja.");
        return;
      }
      if (!krajInput) {
        toast.error("Unesite kraj zastoja.");
        return;
      }
      const krajMs = new Date(krajInput).getTime();
      const startMs = new Date(startIso).getTime();
      if (isNaN(krajMs)) {
        toast.error("Neispravan datum/vreme kraja zastoja.");
        return;
      }
      if (krajMs <= startMs) {
        toast.error(`Kraj zastoja mora biti posle početka (${fmtDt(startIso)}).`);
        return;
      }
    }
    m.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Prijava zastoja</DialogTitle>
          <DialogDescription>
            {active.data?.found ? <>Aktivan zastoj počeo: <strong>{fmtDt(active.data.start)}</strong></> : "Definisanje aktivnog zastoja."}
          </DialogDescription>
        </DialogHeader>

        {noActive && (
          <Alert variant="destructive">
            <AlertDescription>Nema aktivnog zastoja za ovu liniju.</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Grupa zastoja</Label>
            <Select value={grupaId} onValueChange={(v) => { setGrupaId(v); setTipId(""); }} disabled={dd.isLoading || noActive}>
              <SelectTrigger className="h-12"><SelectValue placeholder={dd.isLoading ? "Učitavanje..." : "Izaberite grupu"} /></SelectTrigger>
              <SelectContent>
                {grupe.map((g) => (<SelectItem key={g.id} value={g.id}>{g.naziv}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Tip zastoja</Label>
            <Select value={tipId} onValueChange={setTipId} disabled={!grupaId || tipovi.length === 0 || noActive}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder={!grupaId ? "Prvo izaberite grupu" : tipovi.length === 0 ? "Nema tipova" : "Izaberite tip"} />
              </SelectTrigger>
              <SelectContent>
                {tipovi.map((t) => (<SelectItem key={t.id} value={t.id}>{t.naziv}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <div className="text-sm font-medium">Zastoj je u toku</div>
              <div className="text-xs text-muted-foreground">Iskljuci za podelu zastoja sa krajem.</div>
            </div>
            <Switch checked={ongoing} onCheckedChange={setOngoing} disabled={noActive} />
          </div>

          {!ongoing && (
            <div className="space-y-2">
              <Label>Kraj zastoja</Label>
              <Input type="datetime-local" value={krajInput} onChange={(e) => setKrajInput(e.target.value)} className="h-11" disabled={noActive} />
            </div>
          )}

          <div className="space-y-2">
            <Label>Komentar (opciono)</Label>
            <Textarea value={komentar} onChange={(e) => setKomentar(e.target.value)} rows={3} disabled={noActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="touch" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <AsyncButton size="touch" pending={m.isPending} pendingLabel="Čuvanje..." onClick={handleSave} disabled={!canSave} className="min-w-28">
            Sačuvaj
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
