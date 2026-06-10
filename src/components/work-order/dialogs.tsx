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
import { useTranslation } from "react-i18next";

// ============= Generic confirm dialog for start / resume / pause =============
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
  const [komentar, setKomentar] = useState("");
  const title =
    kind === "start" ? "Pokretanje radnog naloga" :
    kind === "resume" ? "Reaktivacija radnog naloga" : "Pauziranje radnog naloga";
  const btn =
    kind === "start" ? "Pokreni" : kind === "resume" ? "Nastavi" : "Pauziraj";
  const showKomentar = kind === "pause";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setKomentar(""); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {brojNaloga ? <>Nalog <strong>{brojNaloga}</strong>.</> : "Potvrdite akciju."}
          </DialogDescription>
        </DialogHeader>
        {showKomentar && (
          <div className="space-y-2">
            <Label>Komentar (opciono)</Label>
            <Textarea value={komentar} onChange={(e) => setKomentar(e.target.value)} rows={3} placeholder="Razlog..." />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="touch" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <AsyncButton size="touch" pending={pending} onClick={() => onConfirm(komentar.trim() || undefined)} className="min-w-28">{btn}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============= Scrap group/type selectors =============
export function ScrapGroupTypeSelectors({
  grupa, setGrupa, tip, setTip,
}: {
  grupa: string; setGrupa: (v: string) => void; tip: string; setTip: (v: string) => void;
}) {
  const callDropdown = useServerFn(getDropdownDataFn);
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
        <Label>Grupa škarta</Label>
        <Select value={grupa} onValueChange={(v) => { setGrupa(v); setTip(""); }} disabled={q.isLoading}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder={q.isLoading ? "Učitavanje..." : "Izaberite grupu"} />
          </SelectTrigger>
          <SelectContent>
            {grupe.map((g) => (<SelectItem key={g.id} value={g.id}>{g.naziv}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Tip škarta</Label>
        <Select value={tip} onValueChange={setTip} disabled={!grupa || tipovi.length === 0}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder={!grupa ? "Prvo izaberite grupu" : tipovi.length === 0 ? "Nema tipova za izabranu grupu" : "Izaberite tip"} />
          </SelectTrigger>
          <SelectContent>
            {tipovi.map((t) => (<SelectItem key={t.id} value={t.id}>{t.naziv}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ============= Scrap dialog =============
export interface ScrapPayload {
  kolicinaSkarta: number;
  grupaSkartaId: string;
  tipSkartaId: string;
  komentar?: string;
}

export function ScrapDialog({
  open, onOpenChange, onConfirm, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (payload: ScrapPayload) => void;
  pending: boolean;
}) {
  const [skart, setSkart] = useState("");
  const [grupa, setGrupa] = useState("");
  const [tip, setTip] = useState("");
  const [komentar, setKomentar] = useState("");

  const skartNum = Number(skart);
  const valid = !!skart && skartNum > 0 && !!grupa && !!tip;
  const reset = () => { setSkart(""); setGrupa(""); setTip(""); setKomentar(""); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upis škarta</DialogTitle>
          <DialogDescription>Unesite količinu i klasifikaciju škarta.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="scrap-kol" className="text-base">Količina škarta</Label>
            <Input id="scrap-kol" type="number" inputMode="numeric" min={1}
              value={skart} onChange={(e) => setSkart(e.target.value)}
              className="h-14 text-2xl font-semibold text-center" placeholder="0" />
          </div>
          <ScrapGroupTypeSelectors grupa={grupa} setGrupa={setGrupa} tip={tip} setTip={setTip} />
          <div className="space-y-2">
            <Label htmlFor="scrap-komentar">Komentar (opciono)</Label>
            <Textarea id="scrap-komentar" value={komentar} onChange={(e) => setKomentar(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="touch" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <AsyncButton
            size="touch"
            pending={pending}
            pendingLabel="Upisujem..."
            onClick={() => onConfirm({ kolicinaSkarta: skartNum, grupaSkartaId: grupa, tipSkartaId: tip, komentar: komentar.trim() || undefined })}
            disabled={!valid} className="min-w-28">
            Upiši škart
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============= Stop + Batch dialog =============
export interface StopPayload {
  dobroProizvedeno: number;
  kolicinaSkarta?: number;
  grupaSkartaId?: string;
  tipSkartaId?: string;
  komentar?: string;
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
  const [dobro, setDobro] = useState("0");
  const [skart, setSkart] = useState("");
  const [grupa, setGrupa] = useState("");
  const [tip, setTip] = useState("");
  const [komentar, setKomentar] = useState("");

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
          <DialogTitle>Zatvaranje radnog naloga</DialogTitle>
          <DialogDescription>
            {brojNaloga ? <>Zatvori nalog <strong>{brojNaloga}</strong> i upiši konačnu količinu.</> : "Upiši konačnu količinu."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stop-dobro" className="text-base">Dobro proizvedeno</Label>
            <Input id="stop-dobro" type="number" inputMode="numeric" min={0}
              value={dobro} onChange={(e) => setDobro(e.target.value)}
              className="h-14 text-2xl font-semibold text-center" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stop-skart">Škart (opciono)</Label>
            <Input id="stop-skart" type="number" inputMode="numeric" min={0}
              value={skart} onChange={(e) => setSkart(e.target.value)}
              className="h-12" placeholder="0" />
          </div>
          {hasSkart && <ScrapGroupTypeSelectors grupa={grupa} setGrupa={setGrupa} tip={tip} setTip={setTip} />}
          <div className="space-y-2">
            <Label htmlFor="stop-komentar">Komentar (opciono)</Label>
            <Textarea id="stop-komentar" value={komentar} onChange={(e) => setKomentar(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="touch" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <AsyncButton
            size="touch"
            pending={pending}
            pendingLabel="Zatvaram..."
            onClick={() => onConfirm({
              dobroProizvedeno: dobroNum,
              kolicinaSkarta: hasSkart ? skartNum : undefined,
              grupaSkartaId: hasSkart ? grupa : undefined,
              tipSkartaId: hasSkart ? tip : undefined,
              komentar: komentar.trim() || undefined,
            })}
            disabled={!valid}
            className="min-w-28 bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Zatvori nalog
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
