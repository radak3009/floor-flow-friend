import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/ui/async-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getDropdownDataFn } from "@/lib/api/workorder.functions";
import { pickName } from "@/lib/i18n/format";
import { isMassScrapTipName } from "@/lib/scrap";
import { useTranslation, Trans } from "react-i18next";

export type ConfirmActionKind = "start" | "resume" | "pause";

export function ConfirmActionDialog({
  open, onOpenChange, kind, brojNaloga, onConfirm, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: ConfirmActionKind;
  brojNaloga?: string;
  onConfirm: (komentar?: string) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [komentar, setKomentar] = useState("");
  const title =
    kind === "start" ? t("dialogs.start.title") :
    kind === "resume" ? t("dialogs.start.titleResume") : t("dialogs.pause.title");
  const btn =
    kind === "start" ? t("dialogs.start.run") : kind === "resume" ? t("dialogs.start.resume") : t("dialogs.pause.btn");
  const showKomentar = kind === "pause";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setKomentar(""); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {brojNaloga ? (
              <Trans i18nKey="dialogs.confirm.withOrder" values={{ broj: brojNaloga }} components={{ strong: <strong /> }} />
            ) : t("dialogs.confirm.defaultDesc")}
          </DialogDescription>
        </DialogHeader>
        {showKomentar && (
          <div className="space-y-2">
            <Label>{t("dialogs.commentLabel")}</Label>
            <Textarea value={komentar} onChange={(e) => setKomentar(e.target.value)} rows={3} placeholder={t("dialogs.pause.commentPh")} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="touch" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <AsyncButton size="touch" pending={pending} onClick={() => onConfirm(komentar.trim() || undefined)} className="min-w-28">{btn}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScrapGroupTypeSelectors({
  grupa, setGrupa, tip, setTip,
}: {
  grupa: string; setGrupa: (v: string) => void; tip: string; setTip: (v: string) => void;
}) {
  const callDropdown = useServerFn(getDropdownDataFn);
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const q = useQuery({
    queryKey: ["dropdown-data"],
    queryFn: () => callDropdown(),
    staleTime: 10 * 60_000,
  });
  const grupe = q.data?.grupe || [];
  const tipoviAll = q.data?.tipovi || [];
  const tipovi = grupa ? tipoviAll.filter((t) => t.grupaId === grupa) : [];

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="space-y-2">
        <Label>{t("dialogs.scrap.groupLabel")}</Label>
        <Select value={grupa} onValueChange={(v) => { setGrupa(v); setTip(""); }} disabled={q.isLoading}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder={q.isLoading ? t("common.loadingDots") : t("dialogs.scrap.pickGroup")} />
          </SelectTrigger>
          <SelectContent>
            {grupe.map((g) => (<SelectItem key={g.id} value={g.id}>{pickName(g, lang)}</SelectItem>))}
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
            {tipovi.map((t) => (<SelectItem key={t.id} value={t.id}>{pickName(t, lang)}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export interface ScrapPayload {
  kolicinaSkarta: number;
  grupaSkartaId: string;
  tipSkartaId: string;
  komentar?: string;
  masaSkartaKg?: number;
}

export function ScrapDialog({
  open, onOpenChange, onConfirm, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (payload: ScrapPayload) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [skart, setSkart] = useState("");
  const [grupa, setGrupa] = useState("");
  const [tip, setTip] = useState("");
  const [komentar, setKomentar] = useState("");
  const [masa, setMasa] = useState("");

  const callDropdown = useServerFn(getDropdownDataFn);
  const q = useQuery({
    queryKey: ["dropdown-data"],
    queryFn: () => callDropdown(),
    staleTime: 10 * 60_000,
  });
  const tipNaziv = q.data?.tipovi.find((x) => x.id === tip)?.naziv;
  const showMasa = isMassScrapTipName(tipNaziv);

  const skartNum = Number(skart);
  const masaNum = Number(masa);
  const masaValid = !showMasa || masa === "" || (Number.isFinite(masaNum) && masaNum >= 0);
  const valid = !!skart && skartNum > 0 && !!grupa && !!tip && masaValid;
  const reset = () => { setSkart(""); setGrupa(""); setTip(""); setKomentar(""); setMasa(""); };

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
            <Input id="scrap-kol" type="number" inputMode="numeric" min={1}
              value={skart} onChange={(e) => setSkart(e.target.value)}
              className="h-14 text-2xl font-semibold text-center" placeholder="0" />
          </div>
          <ScrapGroupTypeSelectors grupa={grupa} setGrupa={setGrupa} tip={tip} setTip={setTip} />
          {showMasa && (
            <div className="space-y-2">
              <Label htmlFor="scrap-masa">{t("dialogs.scrap.massLabel")}</Label>
              <Input id="scrap-masa" type="number" inputMode="decimal" min={0} step="0.01"
                value={masa} onChange={(e) => setMasa(e.target.value)}
                className="h-12" placeholder={t("dialogs.scrap.massPh")} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="scrap-komentar">{t("dialogs.commentLabel")}</Label>
            <Textarea id="scrap-komentar" value={komentar} onChange={(e) => setKomentar(e.target.value)} rows={2} />
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
              masaSkartaKg: showMasa && masa !== "" && Number.isFinite(masaNum) ? masaNum : undefined,
            })}
            disabled={!valid} className="min-w-28">
            {t("dialogs.scrap.btn")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface StopPayload {
  dobroProizvedeno: number;
  kolicinaSkarta?: number;
  grupaSkartaId?: string;
  tipSkartaId?: string;
  komentar?: string;
  masaSkartaKg?: number;
}

export function StopWithBatchDialog({
  open, onOpenChange, brojNaloga, onConfirm, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brojNaloga?: string;
  onConfirm: (payload: StopPayload) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [dobro, setDobro] = useState("0");
  const [skart, setSkart] = useState("");
  const [grupa, setGrupa] = useState("");
  const [tip, setTip] = useState("");
  const [komentar, setKomentar] = useState("");
  const [masa, setMasa] = useState("");

  const callDropdown = useServerFn(getDropdownDataFn);
  const q = useQuery({
    queryKey: ["dropdown-data"],
    queryFn: () => callDropdown(),
    staleTime: 10 * 60_000,
  });
  const tipNaziv = q.data?.tipovi.find((x) => x.id === tip)?.naziv;

  const skartNum = Number(skart);
  const hasSkart = !!skart && skartNum > 0;
  const showMasa = hasSkart && isMassScrapTipName(tipNaziv);
  const masaNum = Number(masa);
  const masaValid = !showMasa || masa === "" || (Number.isFinite(masaNum) && masaNum >= 0);
  const dobroNum = Number(dobro);
  const validDobro = !isNaN(dobroNum) && dobroNum >= 0;
  const valid = validDobro && (!hasSkart || (!!grupa && !!tip)) && masaValid;
  const reset = () => { setDobro("0"); setSkart(""); setGrupa(""); setTip(""); setKomentar(""); setMasa(""); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("dialogs.stop.title")}</DialogTitle>
          <DialogDescription>
            {brojNaloga ? (
              <Trans i18nKey="dialogs.stop.descWith" values={{ broj: brojNaloga }} components={{ strong: <strong /> }} />
            ) : t("dialogs.stop.descNone")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stop-dobro" className="text-base">{t("dialogs.stop.goodProduced")}</Label>
            <Input id="stop-dobro" type="number" inputMode="numeric" min={0}
              value={dobro} onChange={(e) => setDobro(e.target.value)}
              className="h-14 text-2xl font-semibold text-center" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stop-skart">{t("dialogs.stop.scrapOpt")}</Label>
            <Input id="stop-skart" type="number" inputMode="numeric" min={0}
              value={skart} onChange={(e) => setSkart(e.target.value)}
              className="h-12" placeholder="0" />
          </div>
          {hasSkart && <ScrapGroupTypeSelectors grupa={grupa} setGrupa={setGrupa} tip={tip} setTip={setTip} />}
          {showMasa && (
            <div className="space-y-2">
              <Label htmlFor="stop-masa">{t("dialogs.scrap.massLabel")}</Label>
              <Input id="stop-masa" type="number" inputMode="decimal" min={0} step="0.01"
                value={masa} onChange={(e) => setMasa(e.target.value)}
                className="h-12" placeholder={t("dialogs.scrap.massPh")} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="stop-komentar">{t("dialogs.commentLabel")}</Label>
            <Textarea id="stop-komentar" value={komentar} onChange={(e) => setKomentar(e.target.value)} rows={2} />
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
              masaSkartaKg: showMasa && masa !== "" && Number.isFinite(masaNum) ? masaNum : undefined,
            })}
            disabled={!valid}
            className="min-w-28 bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {t("dialogs.stop.btn")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
