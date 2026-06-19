import { useState, useEffect, useMemo, useRef } from "react";
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
import { pickName, formatDateTime } from "@/lib/i18n/format";
import { useTranslation } from "react-i18next";

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
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const [grupaId, setGrupaId] = useState("");
  const [tipId, setTipId] = useState("");
  const [ongoing, setOngoing] = useState(true);
  const [komentar, setKomentar] = useState("");
  const [krajInput, setKrajInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Idempotency key — STABILAN za jedno otvaranje modala. Više klikova / retry-ja
  // koristi isti ključ pa server svodi na jedan upis.
  const idempotencyKeyRef = useRef<string>("");
  const submittingRef = useRef(false);

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
      setIsSubmitting(false);
      submittingRef.current = false;
      idempotencyKeyRef.current =
        (typeof crypto !== "undefined" && "randomUUID" in crypto)
          ? crypto.randomUUID()
          : `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
          idempotencyKey: idempotencyKeyRef.current,
        },
      );
    },
    onSuccess: (res) => {
      const grupaNaziv = grupaId ? (() => { const g = grupe.find((x) => x.id === grupaId); return g ? pickName(g, lang) : undefined; })() : undefined;
      toast.success(res.queued
        ? t("toast.queuedOffline")
        : (ongoing ? t("downtime.success.defined") : t("downtime.success.split")));
      onSubmitted?.({ ongoing, queued: !!res.queued, grupaNaziv });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || t("common.error")),
    onSettled: () => {
      submittingRef.current = false;
      setIsSubmitting(false);
      invalidateAfterActionDelayed(queryClient, { radniNalogId, monitoringId, resursId });
    },
  });

  const canSave = !noActive && !active.isLoading && (!!grupaId || !!komentar);

  const handleSave = () => {
    if (!ongoing) {
      const startIso = active.data?.start;
      if (!startIso) {
        toast.error(t("downtime.errors.noStart"));
        return;
      }
      if (!krajInput) {
        toast.error(t("downtime.errors.endRequired"));
        return;
      }
      const krajMs = new Date(krajInput).getTime();
      const startMs = new Date(startIso).getTime();
      if (isNaN(krajMs)) {
        toast.error(t("downtime.errors.endInvalid"));
        return;
      }
      if (krajMs <= startMs) {
        toast.error(t("downtime.errors.endAfter", { start: formatDateTime(startIso) }));
        return;
      }
    }
    m.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("downtime.title")}</DialogTitle>
          <DialogDescription>
            {active.data?.found ? <>{t("downtime.activeStartedAt")}<strong>{formatDateTime(active.data.start)}</strong></> : t("downtime.defineActive")}
          </DialogDescription>
        </DialogHeader>

        {noActive && (
          <Alert variant="destructive">
            <AlertDescription>{t("downtime.noActive")}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("downtime.groupLabel")}</Label>
            <Select value={grupaId} onValueChange={(v) => { setGrupaId(v); setTipId(""); }} disabled={dd.isLoading || noActive}>
              <SelectTrigger className="h-12"><SelectValue placeholder={dd.isLoading ? t("common.loadingDots") : t("downtime.pickGroup")} /></SelectTrigger>
              <SelectContent>
                {grupe.map((g) => (<SelectItem key={g.id} value={g.id}>{pickName(g, lang)}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("downtime.typeLabel")}</Label>
            <Select value={tipId} onValueChange={setTipId} disabled={!grupaId || tipovi.length === 0 || noActive}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder={!grupaId ? t("downtime.pickGroupFirst") : tipovi.length === 0 ? t("downtime.noTypes") : t("downtime.pickType")} />
              </SelectTrigger>
              <SelectContent>
                {tipovi.map((t) => (<SelectItem key={t.id} value={t.id}>{pickName(t, lang)}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <div className="text-sm font-medium">{t("downtime.ongoing")}</div>
              <div className="text-xs text-muted-foreground">{t("downtime.ongoingHelp")}</div>
            </div>
            <Switch checked={ongoing} onCheckedChange={setOngoing} disabled={noActive} />
          </div>

          {!ongoing && (
            <div className="space-y-2">
              <Label>{t("downtime.end")}</Label>
              <Input type="datetime-local" value={krajInput} onChange={(e) => setKrajInput(e.target.value)} className="h-11" disabled={noActive} />
            </div>
          )}

          <div className="space-y-2">
            <Label>{t("dialogs.commentLabel")}</Label>
            <Textarea value={komentar} onChange={(e) => setKomentar(e.target.value)} rows={3} disabled={noActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="touch" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <AsyncButton size="touch" pending={m.isPending} pendingLabel={t("common.saving")} onClick={handleSave} disabled={!canSave} className="min-w-28">
            {t("common.save")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
