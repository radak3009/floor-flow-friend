import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "@/components/ui/async-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Kvalitet, Odstupanje } from "@/lib/api/inspection.functions";
import { enqueue } from "@/lib/offline/outbox";
import { toast } from "sonner";
import { invalidateAfterActionDelayed } from "@/lib/query/invalidate";

const OPTION_COLORS: Record<string, { bg: string; text: string }> = {
  "Dobro":          { bg: "#20c933", text: "#fff" },
  "Zadovoljava":    { bg: "#4db56a", text: "#fff" },
  "Nezadovoljava":  { bg: "#f87f6e", text: "#fff" },
  "Neprihvatljivo": { bg: "#e02020", text: "#fff" },
  "N/A":            { bg: "#c2c2c2", text: "#fff" },
  "OK":             { bg: "#20c933", text: "#fff" },
  "N/OK":           { bg: "#e02020", text: "#fff" },
};

function OptionBadge({ label }: { label: string }) {
  const c = OPTION_COLORS[label];
  if (!c) return <span>{label}</span>;
  return (
    <span style={{ backgroundColor: c.bg, color: c.text }}
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold leading-5">
      {label}
    </span>
  );
}

function ColoredSelect({ value, onValueChange, options, placeholder, disabled }: {
  value: string; onValueChange: (v: string) => void; options: string[]; placeholder?: string; disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="h-11">
        {value ? <OptionBadge label={value} /> : <span className="text-muted-foreground">{placeholder ?? "Izaberi..."}</span>}
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (<SelectItem key={o} value={o} className="py-1.5"><OptionBadge label={o} /></SelectItem>))}
      </SelectContent>
    </Select>
  );
}

const KVALITET_OPTIONS: Kvalitet[] = ["Dobro", "Zadovoljava", "Nezadovoljava", "Neprihvatljivo"];
const KVALITET_NA_OPTIONS: Kvalitet[] = [...KVALITET_OPTIONS, "N/A"];
const ODSTUPANJE_OPTIONS: Odstupanje[] = ["OK", "N/OK", "N/A"];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  radniNalogId: string;
  userId: string;
  brojNaloga?: string;
  monitoringId?: string;
  resursId?: string;
}

export default function InspectionModal({ open, onOpenChange, radniNalogId, userId, brojNaloga, monitoringId, resursId }: Props) {
  const queryClient = useQueryClient();

  const [brojIspitanog, setBrojIspitanog] = useState("");
  const [masaG, setMasaG] = useState("");
  const [vizuelno, setVizuelno] = useState<Kvalitet | "">("");
  const [funkcionalno, setFunkcionalno] = useState<Kvalitet | "">("");
  const [integralni, setIntegralni] = useState<Kvalitet | "">("");
  const [odstupanje, setOdstupanje] = useState<Odstupanje | "">("");
  const [kolicinaNeu, setKolicinaNeu] = useState("");
  const [komentar, setKomentar] = useState("");
  const [uzrok, setUzrok] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    if (open) {
      setBrojIspitanog(""); setMasaG(""); setVizuelno(""); setFunkcionalno("");
      setIntegralni(""); setOdstupanje(""); setKolicinaNeu(""); setKomentar(""); setUzrok("");
      setFiles([]);
    }
  }, [open]);

  const valid = Number(brojIspitanog) > 0 && vizuelno && funkcionalno && integralni && odstupanje;

  const fileToBase64 = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const result = r.result as string;
        const idx = result.indexOf(",");
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });

  const m = useMutation({
    mutationFn: async () => {
      const prilozi = await Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          contentType: f.type || "application/octet-stream",
          file: await fileToBase64(f),
        })),
      );
      return enqueue(
        "logInspection",
        `Inspekcija — ${brojNaloga ?? ""}`.trim(),
        {
          radniNalogId,
          userId,
          brojIspitanogKomada: Number(brojIspitanog),
          masaKomadaG: masaG ? Number(masaG) : undefined,
          vizuelno: vizuelno as Kvalitet,
          funkcionalno: funkcionalno as Kvalitet,
          integralniKvalitet: integralni as Kvalitet,
          odstupanjeOdInstrukcija: odstupanje as Odstupanje,
          kolicinaNeusaglasenih: kolicinaNeu ? Number(kolicinaNeu) : undefined,
          komentar: komentar.trim() || undefined,
          uzrokOdstupanja: uzrok.trim() || undefined,
          prilozi: prilozi.length ? prilozi : undefined,
        },
      );
    },
    onSuccess: (res) => {
      toast.success(res.queued ? "Sačuvano lokalno — biće poslato kad se konekcija vrati" : "Inspekcija sačuvana");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Greška"),
    onSettled: () => invalidateAfterActionDelayed(queryClient, { radniNalogId, monitoringId, resursId }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Inspekcija</DialogTitle>
          <DialogDescription>
            {brojNaloga ? <>Radni nalog <strong>{brojNaloga}</strong></> : "Unos inspekcije proizvoda."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Broj ispitanog komada *</Label>
              <Input type="number" min={1} value={brojIspitanog} onChange={(e) => setBrojIspitanog(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Masa komada (g)</Label>
              <Input type="number" min={0} step="0.01" value={masaG} onChange={(e) => setMasaG(e.target.value)} className="h-11" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Vizuelno *</Label>
            <ColoredSelect value={vizuelno} onValueChange={(v) => setVizuelno(v as Kvalitet)} options={KVALITET_OPTIONS} />
          </div>

          <div className="space-y-1.5">
            <Label>Funkcionalno *</Label>
            <ColoredSelect value={funkcionalno} onValueChange={(v) => setFunkcionalno(v as Kvalitet)} options={KVALITET_OPTIONS} />
          </div>

          <div className="space-y-1.5">
            <Label>Integralni kvalitet *</Label>
            <ColoredSelect value={integralni} onValueChange={(v) => setIntegralni(v as Kvalitet)} options={KVALITET_NA_OPTIONS} />
          </div>

          <div className="space-y-1.5">
            <Label>Odstupanje od instrukcija *</Label>
            <ColoredSelect value={odstupanje} onValueChange={(v) => setOdstupanje(v as Odstupanje)} options={ODSTUPANJE_OPTIONS} />
          </div>

          <div className="space-y-1.5">
            <Label>Količina neusaglašenih</Label>
            <Input type="number" min={0} value={kolicinaNeu} onChange={(e) => setKolicinaNeu(e.target.value)} className="h-11" />
          </div>

          <div className="space-y-1.5">
            <Label>Uzrok odstupanja</Label>
            <Textarea rows={2} value={uzrok} onChange={(e) => setUzrok(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Komentar</Label>
            <Textarea rows={2} value={komentar} onChange={(e) => setKomentar(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Prilog</Label>
            <Input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="h-11"
            />
            {files.length > 0 && (
              <ul className="text-xs text-muted-foreground space-y-0.5 pt-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate">{f.name} ({(f.size / 1024).toFixed(0)} KB)</span>
                    <button
                      type="button"
                      className="text-destructive hover:underline"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    >
                      Ukloni
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Maks. 5 MB po fajlu.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="touch" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <AsyncButton size="touch" pending={m.isPending} pendingLabel="Čuvanje..." onClick={() => m.mutate()} disabled={!valid} className="min-w-28">
            Sačuvaj
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
