import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Database, Eye, EyeOff, KeyRound, RotateCw, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/i18n/format";
import {
  getAirtableConfigStatusFn,
  saveAirtableCredentialsFn,
  regenerateSchemaMapsFn,
  clearAirtableOverrideFn,
  type RegenDiff,
} from "@/lib/airtable/config.functions";

export const Route = createFileRoute("/_auth/podesavanja/airtable")({
  head: () => ({ meta: [{ title: "Airtable — Settings" }] }),
  component: AirtableSettings,
});

function isSuperAdminUser(roleName: string | undefined): boolean {
  return (roleName ?? "").trim().toLowerCase() === "super admin";
}

function AirtableSettings() {
  const { t, i18n } = useTranslation();
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
      toast.success(t("settings.airtable.saveOk", { count: res.tableCount }));
      setPat("");
      qc.invalidateQueries({ queryKey: ["airtable-config-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? t("settings.airtable.saveErr")),
  });

  const regenM = useMutation({
    mutationFn: async () => regen({ data: { currentUserId: user!.id } }),
    onSuccess: (res) => {
      setDiff(res);
      toast.success(t("settings.airtable.regenOk", { tables: res.tableCount, fields: res.fieldCount }));
      qc.invalidateQueries({ queryKey: ["airtable-config-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? t("settings.airtable.regenErr")),
  });

  const clearM = useMutation({
    mutationFn: async () => clearCfg({ data: { currentUserId: user!.id } }),
    onSuccess: () => {
      toast.success(t("settings.airtable.resetOk"));
      setDiff(null);
      setPat("");
      setBaseId("");
      qc.invalidateQueries({ queryKey: ["airtable-config-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? t("settings.airtable.genericErr")),
  });

  if (!user) return null;
  if (!isSuper) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 flex items-start gap-3">
          <ShieldAlert className="size-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">{t("settings.airtable.accessDeniedTitle")}</div>
            <div className="text-sm text-muted-foreground mt-1">
              {t("settings.airtable.accessDeniedDesc")}
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
          <ChevronLeft className="size-4" /> {t("settings.airtable.back")}
        </Link>
      </div>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold uppercase tracking-wide">{t("settings.airtable.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("settings.airtable.desc")}
          </p>
        </div>
        <Link
          to="/podesavanja/airtable/mapiranje"
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted/50 font-medium"
        >
          {t("settings.airtable.mappingLink")}
        </Link>
      </div>

      {/* Status */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
            <Database className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">{t("settings.airtable.currentTitle")}</div>
            {statusQ.isLoading && <div className="text-sm text-muted-foreground mt-1">{t("settings.airtable.loading")}</div>}
            {s && !s.hasOverride && (
              <div className="text-sm text-muted-foreground mt-1">
                {t("settings.airtable.originalActive")}
              </div>
            )}
            {s && s.hasOverride && (
              <div className="text-sm mt-1 space-y-1">
                <div>
                  {t("settings.airtable.overrideActive")} <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{s.baseId}</code>
                </div>
                <div className="text-muted-foreground">
                  {t("settings.airtable.mapInfo", { tables: s.tablesCount, fields: s.fieldsCount })}
                  {!s.hasTablesMap && <span className="text-amber-600">{t("settings.airtable.mapNotRegenerated")}</span>}
                </div>
                {s.updatedAt && (
                  <div className="text-xs text-muted-foreground">
                    {t("settings.airtable.updatedAt", { when: formatDateTime(s.updatedAt, i18n.language) })}
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
                if (confirm(t("settings.airtable.resetConfirm"))) clearM.mutate();
              }}
              disabled={clearM.isPending}
            >
              <Trash2 className="size-4 mr-1.5" />
              {t("settings.airtable.reset")}
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
            <div className="font-semibold">{t("settings.airtable.step1Title")}</div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("settings.airtable.step1HintPrefix")}
              <a href="https://airtable.com/create/tokens" target="_blank" rel="noreferrer" className="underline">
                {t("settings.airtable.step1HintLink")}
              </a>
              {t("settings.airtable.step1HintSuffix")}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="baseId">{t("settings.airtable.baseId")}</Label>
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
            <Label htmlFor="pat">{t("settings.airtable.pat")}</Label>
            <div className="relative mt-1">
              <Input
                id="pat"
                type={showPat ? "text" : "password"}
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder={s?.hasOverride ? t("settings.airtable.patPlaceholderHas") : t("settings.airtable.patPlaceholderNew")}
                autoComplete="off"
                spellCheck={false}
                className="font-mono pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPat((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPat ? t("settings.airtable.hidePat") : t("settings.airtable.showPat")}
              >
                {showPat ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t("settings.airtable.patNote")}</p>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => saveM.mutate()}
              disabled={saveM.isPending || !pat.trim() || !baseId.trim()}
            >
              {saveM.isPending ? t("settings.airtable.testing") : t("settings.airtable.testSave")}
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
            <div className="font-semibold">{t("settings.airtable.step2Title")}</div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("settings.airtable.step2Hint")}
            </p>
          </div>
        </div>
        <Button
          onClick={() => regenM.mutate()}
          disabled={regenM.isPending || !s?.hasOverride}
          variant="secondary"
        >
          {regenM.isPending ? t("settings.airtable.regenerating") : t("settings.airtable.regenerate")}
        </Button>

        {diff && (
          <div className="rounded-lg bg-muted/40 p-4 space-y-3 text-sm">
            <div className="font-medium">
              {t("settings.airtable.diffSummary", { tables: diff.tableCount, fields: diff.fieldCount })}
            </div>
            {diff.addedTables.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">{t("settings.airtable.addedTables")}</div>
                <div className="flex flex-wrap gap-1">
                  {diff.addedTables.map((tn) => (
                    <span key={tn} className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded">+{tn}</span>
                  ))}
                </div>
              </div>
            )}
            {diff.removedTables.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">{t("settings.airtable.removedTables")}</div>
                <div className="flex flex-wrap gap-1">
                  {diff.removedTables.map((tn) => (
                    <span key={tn} className="text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">−{tn}</span>
                  ))}
                </div>
              </div>
            )}
            {(Object.keys(diff.addedFieldsByTable).length > 0 || Object.keys(diff.removedFieldsByTable).length > 0) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  {t("settings.airtable.fieldDiffs", { count: Object.keys(diff.addedFieldsByTable).length + Object.keys(diff.removedFieldsByTable).length })}
                </summary>
                <div className="mt-2 space-y-2">
                  {Object.entries(diff.addedFieldsByTable).map(([tn, fs]) => (
                    <div key={`a-${tn}`}>
                      <span className="font-mono">{tn}</span>{" "}
                      <span className="text-emerald-600">+{fs.join(", ")}</span>
                    </div>
                  ))}
                  {Object.entries(diff.removedFieldsByTable).map(([tn, fs]) => (
                    <div key={`r-${tn}`}>
                      <span className="font-mono">{tn}</span>{" "}
                      <span className="text-destructive">−{fs.join(", ")}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {diff.removedTables.length === 0 && Object.keys(diff.removedFieldsByTable).length === 0 && (
              <div className="text-xs text-muted-foreground">{t("settings.airtable.allOk")}</div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
