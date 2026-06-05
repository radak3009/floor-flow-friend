import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getBootstrapStateFn,
  bootstrapSaveCredsFn,
  bootstrapRegenerateFn,
  bootstrapApplyOverridesFn,
  getSupabaseReadinessFn,
  bootstrapSmokeTestFn,
  bootstrapFinalizeFn,
} from "@/lib/airtable/bootstrap.functions";
import { REQUIRED_AUTOMATIONS } from "@/lib/airtable/required-schema";
import type { MissingRequiredEntry } from "@/lib/airtable/required-schema";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "Bootstrap — MES Shop Floor" }] }),
  component: SetupWizard,
});

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

function SetupWizard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getState = useServerFn(getBootstrapStateFn);
  const saveCreds = useServerFn(bootstrapSaveCredsFn);
  const regenerate = useServerFn(bootstrapRegenerateFn);
  const applyOverrides = useServerFn(bootstrapApplyOverridesFn);
  const getSupabaseReadiness = useServerFn(getSupabaseReadinessFn);
  const runSmokeTest = useServerFn(bootstrapSmokeTestFn);
  const finalize = useServerFn(bootstrapFinalizeFn);

  const stateQ = useQuery({
    queryKey: ["bootstrap-state"],
    queryFn: () => getState({}),
    refetchOnWindowFocus: false,
  });

  const [step, setStep] = useState<Step>(1);
  const [pat, setPat] = useState("");
  const [baseId, setBaseId] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [missing, setMissing] = useState<MissingRequiredEntry[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({}); // key = `${table}::${camel}` → fieldId
  const [autoConfirmed, setAutoConfirmed] = useState<Record<string, boolean>>({});
  const [autoExpanded, setAutoExpanded] = useState<Record<string, boolean>>({});

  const saveM = useMutation({
    mutationFn: async () => saveCreds({ data: { pat: pat.trim(), baseId: baseId.trim() } }),
    onSuccess: (res) => {
      toast.success(`Konekcija OK. Pronađeno ${res.tableCount} tabela.`);
      setPat("");
      setStep(2);
    },
    onError: (e: any) => toast.error(e?.message ?? "Greška pri čuvanju"),
  });

  const regenM = useMutation({
    mutationFn: async () => regenerate({}),
    onSuccess: (res) => {
      toast.success(`Mapa regenerisana: ${res.tableCount} tabela, ${res.fieldCount} polja.`);
      setMissing(res.missingRequired);
      const initialPicks: Record<string, string> = {};
      for (const m of res.missingRequired) {
        const guess = m.candidateFields.find((c) =>
          c.name.toLowerCase().includes(m.key.toLowerCase()),
        );
        if (guess) initialPicks[`${m.table}::${m.key}`] = guess.id;
      }
      setPicks(initialPicks);
      setStep(3);
    },
    onError: (e: any) => toast.error(e?.message ?? "Greška pri regeneraciji"),
  });

  const applyM = useMutation({
    mutationFn: async () => {
      const overrides = Object.entries(picks)
        .filter(([, v]) => !!v)
        .map(([k, v]) => {
          const [table, key] = k.split("::");
          return { table, key, fieldId: v };
        });
      return applyOverrides({ data: { overrides } });
    },
    onSuccess: (res) => {
      setMissing(res.missingRequired);
      if (res.missingRequired.length === 0) {
        toast.success("Sva obavezna polja su mapirana.");
        setStep(4);
      } else {
        toast.message(`Još ${res.missingRequired.length} obaveznih polja nije mapirano.`);
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Greška pri primeni override-a"),
  });

  const supabaseQ = useQuery({
    queryKey: ["bootstrap-supabase"],
    queryFn: () => getSupabaseReadiness({}),
    enabled: step === 5,
    refetchOnWindowFocus: false,
  });

  const smokeM = useMutation({
    mutationFn: async () => runSmokeTest({}),
    onError: (e: any) => toast.error(e?.message ?? "Smoke test je pao"),
  });

  const unresolvedCount = useMemo(
    () => missing.filter((m) => !picks[`${m.table}::${m.key}`]).length,
    [missing, picks],
  );

  useEffect(() => {
    if (stateQ.data && stateQ.data.baseId) setBaseId(stateQ.data.baseId);
  }, [stateQ.data]);

  // Restore automation checklist state from localStorage per baseId
  const autoStorageKey = useMemo(
    () => (baseId ? `mes:setup:automations:${baseId}` : null),
    [baseId],
  );
  useEffect(() => {
    if (!autoStorageKey) return;
    try {
      const raw = window.localStorage.getItem(autoStorageKey);
      if (raw) setAutoConfirmed(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, [autoStorageKey]);
  useEffect(() => {
    if (!autoStorageKey) return;
    try {
      window.localStorage.setItem(autoStorageKey, JSON.stringify(autoConfirmed));
    } catch {
      // ignore
    }
  }, [autoStorageKey, autoConfirmed]);

  const allAutomationsConfirmed = REQUIRED_AUTOMATIONS.every((a) => autoConfirmed[a.id]);

  // Blokada pristupa ako sistem već radi i nemamo SETUP_TOKEN
  if (stateQ.isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (stateQ.data && !stateQ.data.bootstrapMode) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="max-w-md text-center rounded-xl border border-border bg-card p-6">
          <ShieldAlert className="size-10 text-amber-500 mx-auto mb-3" />
          <div className="font-semibold text-lg">Sistem je već konfigurisan</div>
          <p className="text-sm text-muted-foreground mt-2">
            Bootstrap wizard je dostupan samo dok ne postoji validna Airtable konfiguracija.
            Idi na Podešavanja → Airtable da menjaš mapiranje, ili kontaktiraj administratora
            za <code>SETUP_TOKEN</code>.
          </p>
          <Button className="mt-4" onClick={() => navigate({ to: "/" })}>
            Idi na prijavu
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
            <Wand2 className="size-3.5" /> BOOTSTRAP
          </div>
          <h1 className="text-2xl font-semibold mt-3">Prva konekcija na Airtable</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pre nego što iko može da se uloguje, treba povezati aplikaciju sa vašom Airtable bazom
            i validirati mapiranje polja.
          </p>
        </header>

        <Stepper step={step} />

        {step === 1 && (
          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <Header
              icon={<KeyRound className="size-5" />}
              title="1. Unesi PAT i Base ID"
              hint={
                <>
                  PAT kreiraj na{" "}
                  <a href="https://airtable.com/create/tokens" target="_blank" rel="noreferrer" className="underline">
                    airtable.com/create/tokens
                  </a>{" "}
                  sa scope-ovima <code>data.records:read</code>, <code>data.records:write</code>,{" "}
                  <code>schema.bases:read</code> i dodaj svoj Base.
                </>
              }
            />
            <div className="space-y-3">
              <div>
                <Label htmlFor="baseId">Base ID</Label>
                <Input
                  id="baseId"
                  value={baseId}
                  onChange={(e) => setBaseId(e.target.value)}
                  placeholder="appXXXXXXXXXXXXXX"
                  className="font-mono mt-1"
                  autoComplete="off"
                  spellCheck={false}
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
                    placeholder="patXXXXXXXXXXXXXX.YYYYYYYYYYYYYY"
                    className="font-mono pr-10"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPat((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPat ? "Sakrij PAT" : "Prikaži PAT"}
                  >
                    {showPat ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => saveM.mutate()}
                disabled={saveM.isPending || !pat.trim() || !baseId.trim()}
              >
                {saveM.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Sačuvaj i testiraj <ArrowRight className="size-4 ml-2" />
              </Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <Header
              icon={<Database className="size-5" />}
              title="2. Regeneriši mapu tabela i polja"
              hint="Aplikacija će povući strukturu nove baze i automatski pokušati da poveže polja po nazivu."
            />
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(1)} disabled={regenM.isPending}>
                Nazad
              </Button>
              <Button onClick={() => regenM.mutate()} disabled={regenM.isPending}>
                {regenM.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                Pokreni regeneraciju <ArrowRight className="size-4 ml-2" />
              </Button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <Header
              icon={<ShieldAlert className="size-5" />}
              title="3. Validacija obaveznih polja"
              hint={
                missing.length === 0
                  ? "Sva obavezna polja su automatski mapirana."
                  : `Treba ručno mapirati ${missing.length} polja koja nisu pronađena po nazivu.`
              }
            />

            {missing.length === 0 ? (
              <div className="rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 p-4 flex items-start gap-2">
                <CheckCircle2 className="size-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                  Svi ključevi koje aplikacija obavezno koristi su pronađeni u vašoj bazi po
                  nazivu. Možeš da nastaviš.
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {groupByTable(missing).map(([tableLabel, items]) => (
                  <div key={tableLabel} className="rounded-lg border border-border p-3">
                    <div className="text-sm font-semibold mb-2">{tableLabel}</div>
                    <div className="space-y-2">
                      {items.map((m) => {
                        const key = `${m.table}::${m.key}`;
                        return (
                          <div
                            key={key}
                            className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-2 items-center"
                          >
                            <div className="text-sm">
                              <div className="font-medium">{m.label}</div>
                              {m.hint && (
                                <div className="text-xs text-muted-foreground">{m.hint}</div>
                              )}
                            </div>
                            <Select
                              value={picks[key] ?? ""}
                              onValueChange={(v) => setPicks((p) => ({ ...p, [key]: v }))}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="— Izaberi polje iz baze —" />
                              </SelectTrigger>
                              <SelectContent>
                                {m.candidateFields.length === 0 && (
                                  <div className="text-sm text-muted-foreground px-2 py-1.5">
                                    Tabela ne postoji u bazi
                                  </div>
                                )}
                                {m.candidateFields.map((f) => (
                                  <SelectItem key={f.id} value={f.id}>
                                    {f.name}
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {f.id}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>
                Nazad
              </Button>
              {missing.length === 0 ? (
                <Button onClick={() => setStep(4)}>
                  Završi <ArrowRight className="size-4 ml-2" />
                </Button>
              ) : (
                <Button
                  onClick={() => applyM.mutate()}
                  disabled={applyM.isPending || unresolvedCount > 0}
                >
                  {applyM.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                  Primeni mapiranje
                  {unresolvedCount > 0 ? ` (još ${unresolvedCount} za izbor)` : ""}
                </Button>
              )}
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <Header
              icon={<Wand2 className="size-5" />}
              title="4. Potvrdi Airtable automatizacije"
              hint="Sledeće automatizacije moraju postojati u tvojoj Airtable bazi. Aplikacija ne može da ih instalira preko API-ja — moraš ih napraviti ručno u Airtable interfejsu (Automations) i potom potvrditi."
            />
            <div className="space-y-3">
              {REQUIRED_AUTOMATIONS.map((a) => {
                const checked = !!autoConfirmed[a.id];
                const open = !!autoExpanded[a.id];
                return (
                  <div key={a.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={`auto-${a.id}`}
                        checked={checked}
                        onCheckedChange={(v) =>
                          setAutoConfirmed((p) => ({ ...p, [a.id]: v === true }))
                        }
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <Label htmlFor={`auto-${a.id}`} className="font-medium cursor-pointer">
                          {a.name}
                        </Label>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Tabela: <code>{a.table}</code>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAutoExpanded((p) => ({ ...p, [a.id]: !open }))}
                          className="text-primary text-xs mt-1 hover:underline"
                        >
                          {open ? "Sakrij detalje" : "Kako podesiti"}
                        </button>
                        {open && (
                          <div className="mt-2 space-y-1.5 text-sm bg-muted/40 rounded p-2">
                            <div><span className="font-semibold">Trigger:</span> {a.trigger}</div>
                            <div><span className="font-semibold">Action:</span> {a.action}</div>
                            <div className="text-xs text-muted-foreground">
                              <span className="font-semibold">Zašto:</span> {a.why}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(3)}>
                Nazad
              </Button>
              <Button onClick={() => setStep(5)} disabled={!allAutomationsConfirmed}>
                Nastavi <ArrowRight className="size-4 ml-2" />
              </Button>
            </div>
          </section>
        )}

        {step === 5 && (
          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <Header
              icon={<Database className="size-5" />}
              title="5. Provera Supabase tabela"
              hint="Aplikacija zavisi od pratećih tabela u Lovable Cloud-u (overrides, lock-ovi, keš, audit). Ako neka nedostaje, primeni migracije iz supabase/migrations/ na novi projekat."
            />
            {supabaseQ.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Provera…
              </div>
            ) : supabaseQ.data ? (
              <div className="space-y-2">
                {supabaseQ.data.tables.map((t) => (
                  <div
                    key={t.table}
                    className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5"
                  >
                    <div className="font-mono text-sm">{t.table}</div>
                    {t.ok ? (
                      <span className="text-emerald-600 dark:text-emerald-400 text-sm shrink-0">
                        ✅ OK
                      </span>
                    ) : (
                      <div className="text-right text-xs text-destructive max-w-[60%] break-words">
                        ❌ {t.error}
                      </div>
                    )}
                  </div>
                ))}
                {!supabaseQ.data.allOk && (
                  <div className="rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 p-3 text-sm">
                    Neke tabele nedostaju. Override sloj, audit i throttle neće raditi dok ne
                    primeniš migracije.
                  </div>
                )}
              </div>
            ) : null}
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(4)}>
                Nazad
              </Button>
              <Button
                onClick={() => setStep(6)}
                disabled={supabaseQ.isLoading}
              >
                Nastavi <ArrowRight className="size-4 ml-2" />
              </Button>
            </div>
          </section>
        )}

        {step === 6 && (
          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <Header
              icon={<ShieldAlert className="size-5" />}
              title="6. Smoke test (aktivna provera upisa)"
              hint="Pokušaće test upis u PromeneNaloga i PrijaveNaSistem (odmah se brišu) i potvrditi da PAT ima data.records:write scope. Tihe greške koje se inače gube u logovima ovde se prikazuju eksplicitno."
            />
            <Button
              onClick={() => smokeM.mutate()}
              disabled={smokeM.isPending}
              variant="outline"
            >
              {smokeM.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              {smokeM.data ? "Pokreni ponovo" : "Pokreni proveru"}
            </Button>
            {smokeM.data && (
              <div className="space-y-2">
                <SmokeRow label="PAT write scope" check={smokeM.data.patWrite} />
                <SmokeRow label="Upis u PromeneNaloga" check={smokeM.data.promeneNaloga} />
                <SmokeRow label="Upis u PrijaveNaSistem" check={smokeM.data.prijaveNaSistem} />
              </div>
            )}
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(5)}>
                Nazad
              </Button>
              <Button
                onClick={() => setStep(7)}
                disabled={!smokeM.data || !smokeM.data.promeneNaloga.ok}
              >
                Završi <ArrowRight className="size-4 ml-2" />
              </Button>
            </div>
          </section>
        )}

        {step === 7 && (
          <section className="rounded-xl border border-border bg-card p-6 space-y-4 text-center">
            <CheckCircle2 className="size-12 text-emerald-500 mx-auto" />
            <div>
              <div className="font-semibold text-lg">Konfiguracija je spremna</div>
              <p className="text-sm text-muted-foreground mt-1">
                Aplikacija je sada povezana sa vašom Airtable bazom. Možeš da se prijaviš sa
                podacima Super Admin korisnika iz nove baze. Detalje koraka pogledaj u{" "}
                <code>REMIX.md</code>.
              </p>
            </div>
            <Button
              size="lg"
              onClick={async () => {
                try {
                  await finalize({});
                } catch (e: any) {
                  toast.error(e?.message ?? "Finalizacija nije uspela");
                  return;
                }
                await qc.invalidateQueries({ queryKey: ["bootstrap-state"] });
                navigate({ to: "/" });
              }}
            >
              Idi na prijavu <ArrowRight className="size-4 ml-2" />
            </Button>
          </section>
        )}


      </div>
    </div>
  );
}

function Header({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
        {icon}
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        {hint && <p className="text-sm text-muted-foreground mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function SmokeRow({ label, check }: { label: string; check: { ok: boolean; message?: string } }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5">
      <div className="text-sm font-medium">{label}</div>
      {check.ok ? (
        <span className="text-emerald-600 dark:text-emerald-400 text-sm shrink-0">
          ✅ OK{check.message ? ` — ${check.message}` : ""}
        </span>
      ) : (
        <div className="text-right text-xs text-destructive max-w-[60%] break-words">
          ❌ {check.message ?? "Nepoznata greška"}
        </div>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const labels = ["PAT/Base", "Regeneracija", "Validacija", "Automatizacije", "Supabase", "Smoke", "Završeno"];
  return (
    <ol className="flex items-center gap-2 text-xs">
      {labels.map((l, i) => {
        const n = (i + 1) as Step;
        const active = step === n;
        const done = step > n;
        return (
          <li key={l} className="flex items-center gap-2">
            <span
              className={`grid place-items-center size-6 rounded-full text-[11px] font-semibold ${
                done
                  ? "bg-emerald-500 text-white"
                  : active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span className={active ? "font-medium" : "text-muted-foreground"}>{l}</span>
            {i < labels.length - 1 && <span className="text-muted-foreground/40">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

function groupByTable(items: MissingRequiredEntry[]): Array<[string, MissingRequiredEntry[]]> {
  const map = new Map<string, MissingRequiredEntry[]>();
  for (const it of items) {
    const arr = map.get(it.tableLabel) ?? [];
    arr.push(it);
    map.set(it.tableLabel, arr);
  }
  return [...map.entries()];
}
