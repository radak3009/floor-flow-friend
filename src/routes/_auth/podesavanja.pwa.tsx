import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Upload, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getPwaConfigFn,
  updatePwaConfigFn,
  uploadPwaIconsFn,
  resetPwaConfigFn,
} from "@/lib/pwa/config.functions";

export const Route = createFileRoute("/_auth/podesavanja/pwa")({
  component: PwaSettingsPage,
});

const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

function PwaSettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const roleName = norm(user?.roleName);
  const isAdmin = roleName === "admin" || roleName === "super admin";

  useEffect(() => {
    if (user && !isAdmin) navigate({ to: "/podesavanja" });
  }, [user, isAdmin, navigate]);

  const qc = useQueryClient();
  const getCfg = useServerFn(getPwaConfigFn);
  const updateCfg = useServerFn(updatePwaConfigFn);
  const uploadIcons = useServerFn(uploadPwaIconsFn);
  const resetCfg = useServerFn(resetPwaConfigFn);

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["pwa-config"],
    queryFn: () => getCfg(),
  });

  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [themeColor, setThemeColor] = useState("#1f2937");
  const [backgroundColor, setBackgroundColor] = useState("#1f2937");
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cfg) {
      setName(cfg.name);
      setShortName(cfg.shortName);
      setThemeColor(cfg.themeColor);
      setBackgroundColor(cfg.backgroundColor);
      setIconPreview(cfg.icon512Url ?? cfg.icon192Url ?? null);
    }
  }, [cfg]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error(t("settings.pwa.noSession"));
      return updateCfg({
        data: {
          currentUserId: user.id,
          name: name.trim(),
          shortName: shortName.trim(),
          themeColor,
          backgroundColor,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("settings.pwa.saved"));
      qc.invalidateQueries({ queryKey: ["pwa-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error(t("settings.pwa.noSession"));
      const [b192, b512] = await Promise.all([
        resizeToDataUrl(file, 192, t),
        resizeToDataUrl(file, 512, t),
      ]);
      return uploadIcons({
        data: { currentUserId: user.id, icon192Base64: b192, icon512Base64: b512 },
      });
    },
    onSuccess: (r) => {
      toast.success(t("settings.pwa.iconSaved"));
      setIconPreview(r.icon512Url);
      qc.invalidateQueries({ queryKey: ["pwa-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error(t("settings.pwa.noSession"));
      return resetCfg({ data: { currentUserId: user.id } });
    },
    onSuccess: () => {
      toast.success(t("settings.pwa.resetSuccess"));
      qc.invalidateQueries({ queryKey: ["pwa-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!user || !isAdmin) return null;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/podesavanja"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {t("settings.pwa.back")}
        </Link>
      </div>
      <div>
        <h1 className="text-xl font-semibold uppercase tracking-wide">{t("settings.pwa.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("settings.pwa.desc")}
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.pwa.nameColorTitle")}</CardTitle>
              <CardDescription>
                {t("settings.pwa.nameColorDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t("settings.pwa.name")}</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="short">{t("settings.pwa.shortName")}</Label>
                <Input
                  id="short"
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  maxLength={20}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="theme">{t("settings.pwa.themeColor")}</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="theme"
                      type="color"
                      value={themeColor}
                      onChange={(e) => setThemeColor(e.target.value)}
                      className="h-9 w-12 rounded border border-input bg-transparent"
                    />
                    <Input
                      value={themeColor}
                      onChange={(e) => setThemeColor(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bg">{t("settings.pwa.bgColor")}</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="bg"
                      type="color"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      className="h-9 w-12 rounded border border-input bg-transparent"
                    />
                    <Input
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </div>
              </div>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                <Save className="size-4 mr-2" />
                {saveMut.isPending ? t("settings.pwa.saving") : t("settings.pwa.save")}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("settings.pwa.iconTitle")}</CardTitle>
              <CardDescription>
                {t("settings.pwa.iconDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-6">
                <div
                  className="size-24 rounded-2xl grid place-items-center overflow-hidden border"
                  style={{ background: backgroundColor }}
                >
                  {iconPreview ? (
                    <img src={iconPreview} alt={t("settings.pwa.iconTitle")} className="size-full object-cover" />
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("settings.pwa.noIcon")}</span>
                  )}
                </div>
                <div className="text-sm">
                  <div className="font-medium">{shortName || "—"}</div>
                  <div className="text-muted-foreground text-xs">{t("settings.pwa.homeScreenHint")}</div>
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadMut.mutate(f);
                  e.target.value = "";
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadMut.isPending}
                >
                  <Upload className="size-4 mr-2" />
                  {uploadMut.isPending ? t("settings.pwa.uploading") : t("settings.pwa.changeIcon")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => resetMut.mutate()}
                  disabled={resetMut.isPending}
                >
                  <RotateCcw className="size-4 mr-2" />
                  {t("settings.pwa.resetIcon")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            {t("settings.pwa.note")}
          </div>
        </>
      )}
    </div>
  );
}

async function resizeToDataUrl(file: File, size: number, t: (k: string) => string): Promise<string> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t("settings.pwa.canvasErr"));
  const ratio = Math.max(size / bmp.width, size / bmp.height);
  const w = bmp.width * ratio;
  const h = bmp.height * ratio;
  const dx = (size - w) / 2;
  const dy = (size - h) / 2;
  ctx.drawImage(bmp, dx, dy, w, h);
  return canvas.toDataURL("image/png");
}
