import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Database, Eye, EyeOff, KeyRound, RotateCw, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import {
  getAirtableConfigStatusFn,
  saveAirtableCredentialsFn,
  regenerateSchemaMapsFn,
  clearAirtableOverrideFn,
  type RegenDiff,
} from "@/lib/airtable/config.functions";

export const Route = createFileRoute("/_auth/podesavanja/airtable")({
  head: () => ({ meta: [{ title: "Airtable konfiguracija — Podešavanja" }] }),
  component: AirtableSettings,
});

function isSuperAdminUser(roleName: string | undefined): boolean {
  return (roleName ?? "").trim().toLowerCase() === "super admin";
}

function AirtableSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const getStatus = useServerFn(getAirtableConfigStatusFn);
  const saveCreds = useServerFn(saveAirtableCredentialsFn);
  const regen = useServerFn(regenerateSchemaMapsFn);
  const clearCfg = useServerFn(clearAirtableOverrideFn);

  const isSuper = isSuperAdminUser(user?.roleName);

  const statusQ = useQuery({
    queryKey: ["airtable-config-status", user?.id],
    enabled: !!user?.id && isSuper,
    queryFn: () => getStatus({ data: { currentUserId: user!.id } }),
  });

  const [pat, setPat] = useState("");
  const [baseId, setBaseId] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [diff, setDiff] = useState<RegenDiff | null>(null);

  useEffect(() => {
    if (statusQ.data?.baseId) setBaseId(statusQ.data.baseId);
  }, [statusQ.data?.baseId]);

  const saveM = useMutation({
    mutationFn: async () => saveCreds({ data: { currentUserId: user!.id, pat: pat.trim(), baseId: baseId.trim() } }),
    onSuccess: (res) => {
      toast.success(`Konekcija OK. Pronađeno ${res.tableCount} tabela.`);
      setPat("");
      qc.invalidateQueries({ queryKey: ["airtable-config-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Greška pri čuvanju"),
  });

  const regenM = useMutation({
    mutationFn: async () => regen({ data: { currentUserId: user!.id } }),
    onSuccess: (res) => {
      setDiff(res);
      toast.success(`Mapa regenerisana: ${res.tableCount} tabela, ${res.fieldCount} polja.`);
      qc.invalidateQueries({ queryKey: ["airtable-config-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Greška pri regeneraciji"),
  });

  const clearM = useMutation({
    mutationFn: async () => clearCfg({ data: { currentUserId: user!.id } }),
    onSuccess: () => {
      toast.success("Vraćeno na originalnu konfiguraciju.");
      setDiff(null);
      setPat("");
      setBaseId("");
      qc.invalidateQueries({ queryKey: ["airtable-config-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Greška"),
  });

  if (!user) return null;
  if (!isSuper) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 flex items-start gap-3">
          <ShieldAlert className="size-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Pristup zabranjen</div>
            <div className="text-sm text-muted-foreground mt-1">
              Samo Super Admin može da menja Airtable konfiguraciju.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const s = statusQ.data;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/podesavanja" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronLeft className="size-4" /> Podešavanja
        </Link>
      </div>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold uppercase tracking-wide">Airtable baza</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Poveži aplikaciju sa drugom Airtable bazom unosom PAT-a i Base ID-ja, pa regeneriši mapu tabela i polja.
          </p>
        </div>
        <Link
          to="/podesavanja/airtable/mapiranje"
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted/50 font-medium"
        >
          Mapiranje polja (pre/posle) →
        </Link>
      </div>

      {/* Status */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <Database className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">Trenutna konfiguracija</div>
            {statusQ.isLoading && <div className="text-sm text-muted-foreground mt-1">Učitavanje…</div>}
            {s && !s.hasOverride && (
              <div className="text-sm text-muted-foreground mt-1">
                Aktivna je <span className="font-medium text-foreground">originalna</span> konfiguracija
                (Lovable konektor + statički schema.ts).
              </div>
            )}
            {s && s.hasOverride && (
              <div className="text-sm mt-1 space-y-1">
                <div>
                  Override aktivan · Base ID: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{s.baseId}</code>
                </div>
                <div className="text-muted-foreground">
                  Mapa: {s.tablesCount} tabela, {s.fieldsCount} polja
                  {!s.hasTablesMap && <span className="text-amber-600"> · ⚠ mapa nije regenerisana (koristi se statička)</span>}
                </div>
                {s.updatedAt && (
                  <div className="text-xs text-muted-foreground">
                    Ažurirano: {new Date(s.updatedAt).toLocaleString("sr-RS")}
                  </div>
                )}
              </div>
            )}
          </div>
          {s?.hasOverride && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm("Vratiti na originalnu konfiguraciju? Sačuvana PAT i mapa biće obrisani.")) clearM.mutate();
              }}
              disabled={clearM.isPending}
            >
              <Trash2 className="size-4 mr-1.5" />
              Reset
            </Button>
          )}
        </div>
      </section>

      {/* Forma */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <KeyRound className="size-5" />
          </div>
          <div>
            <div className="font-semibold">1. Unesi credentijale druge organizacije</div>
            <p className="text-sm text-muted-foreground mt-0.5">
              PAT kreiraj na <a href="https://airtable.com/create/tokens" target="_blank" rel="noreferrer" className="underline">airtable.com/create/tokens</a> sa scope-ovima: <code>data.records:read</code>, <code>data.records:write</code>, <code>schema.bases:read</code> i dodatim Base-om.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="baseId">Base ID</Label>
            <Input
              id="baseId"
              value={baseId}
              onChange={(e) => setBaseId(e.target.value)}
              placeholder="appXXXXXXXXXXXXXX"
              autoComplete="off"
              spellCheck={false}
              className="font-mono mt-1"
            />
          </div>
          <div>
            <Label htmlFor="pat">Personal Access Token (PAT)</Label>
            <div className="relative mt-1">
              <Input
                id="pat"
                type={showPat ? "text" : "password"}
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder={s?.hasOverride ? "Unesi novi PAT samo ako menjaš" : "pat...xxxxxxx.xxxxxxx"}
                autoComplete="off"
                spellCheck={false}
                className="font-mono pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPat((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPat ? "Sakrij" : "Prikaži"}
              >
                {showPat ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">PAT se šifrovan čuva u Lovable Cloud bazi i nikad se ne vraća klijentu.</p>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => saveM.mutate()}
              disabled={saveM.isPending || !pat.trim() || !baseId.trim()}
            >
              {saveM.isPending ? "Testiranje…" : "Testiraj i sačuvaj"}
            </Button>
          </div>
        </div>
      </section>

      {/* Regeneracija */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <RotateCw className="size-5" />
          </div>
          <div>
            <div className="font-semibold">2. Regeneriši mapu tabela i polja</div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Povuče sve tabele i polja iz Airtable Metadata API i sačuva ih u bazi. Pokreni odmah nakon koraka 1, i svaki put kada se šema baze promeni.
            </p>
          </div>
        </div>
        <Button
          onClick={() => regenM.mutate()}
          disabled={regenM.isPending || !s?.hasOverride}
          variant="secondary"
        >
          {regenM.isPending ? "Regeneracija…" : "Regeneriši mapu"}
        </Button>

        {diff && (
          <div className="rounded-lg bg-muted/40 p-4 space-y-3 text-sm">
            <div className="font-medium">
              ✓ {diff.tableCount} tabela · {diff.fieldCount} polja
            </div>
            {diff.addedTables.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Dodate tabele (van šeme):</div>
                <div className="flex flex-wrap gap-1">
                  {diff.addedTables.map((t) => (
                    <span key={t} className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded">+{t}</span>
                  ))}
                </div>
              </div>
            )}
            {diff.removedTables.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Nedostaju tabele (postoje u originalnoj):</div>
                <div className="flex flex-wrap gap-1">
                  {diff.removedTables.map((t) => (
                    <span key={t} className="text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">−{t}</span>
                  ))}
                </div>
              </div>
            )}
            {(Object.keys(diff.addedFieldsByTable).length > 0 || Object.keys(diff.removedFieldsByTable).length > 0) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Razlike po poljima ({Object.keys(diff.addedFieldsByTable).length + Object.keys(diff.removedFieldsByTable).length} tabela)
                </summary>
                <div className="mt-2 space-y-2">
                  {Object.entries(diff.addedFieldsByTable).map(([t, fs]) => (
                    <div key={`a-${t}`}>
                      <span className="font-mono">{t}</span>{" "}
                      <span className="text-emerald-600">+{fs.join(", ")}</span>
                    </div>
                  ))}
                  {Object.entries(diff.removedFieldsByTable).map(([t, fs]) => (
                    <div key={`r-${t}`}>
                      <span className="font-mono">{t}</span>{" "}
                      <span className="text-destructive">−{fs.join(", ")}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {diff.removedTables.length === 0 && Object.keys(diff.removedFieldsByTable).length === 0 && (
              <div className="text-xs text-muted-foreground">Sve tabele/polja iz originalne šeme postoje u novoj bazi. Aplikacija je spremna.</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
