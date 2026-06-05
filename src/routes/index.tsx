import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { loginFn } from "@/lib/api/auth.functions";
import { getBootstrapStateFn } from "@/lib/airtable/bootstrap.functions";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Factory, Delete, Loader2 } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";

export const Route = createFileRoute("/")({ component: LoginPage });

function detectDevice(): string {
  if (typeof navigator === "undefined") return "PC";
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobi))/i.test(ua)) return "Tablet";
  if (/mobi|iphone|ipod|android.*mobi/i.test(ua)) return "Mobilni";
  return "PC";
}

function LoginPage() {
  const { t } = useTranslation();
  const { user, login, ready } = useAuth();
  const navigate = useNavigate();
  const callLogin = useServerFn(loginFn);
  const getBootstrapState = useServerFn(getBootstrapStateFn);

  const bootstrapQ = useQuery({
    queryKey: ["bootstrap-state"],
    queryFn: () => getBootstrapState({}),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const [step, setStep] = useState<"id" | "pin">("id");
  const [id, setId] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) navigate({ to: "/shop-floor" });
  }, [ready, user, navigate]);

  useEffect(() => {
    if (bootstrapQ.data?.bootstrapMode) {
      navigate({ to: "/setup" });
    }
  }, [bootstrapQ.data, navigate]);

  const value = step === "id" ? id : pin;
  const setValue = step === "id" ? setId : setPin;

  function push(d: string) {
    setErr(null);
    setValue((v) => (v + d).slice(0, 12));
  }
  function back() { setValue((v) => v.slice(0, -1)); }
  function clear() { setValue(""); }

  async function submit() {
    if (step === "id") {
      if (!id.trim()) return;
      setStep("pin");
      return;
    }
    if (!pin.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await callLogin({ data: { idZaposlenog: id.trim(), pin: pin.trim(), uredaj: detectDevice() } });
      if (!res.success) {
        setErr(res.error);
        setPin("");
        return;
      }
      login({ ...res.user!, token: res.token });
      toast.success(t("login.welcome", { name: res.user!.imeIPrezime }));
      // Navigacija je u useEffect-u koji čeka `ready && user` —
      // sprečava race kada navigate okine pre nego što se React state propagira.
    } catch (e: any) {
      setErr(e?.message || t("login.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const keys = ["1","2","3","4","5","6","7","8","9","C","0","back"];

  if (bootstrapQ.isLoading || bootstrapQ.data?.bootstrapMode) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md bg-card border border-border rounded-xl p-6 shadow-2xl">
        <div className="flex justify-end mb-3">
          <LanguageToggle />
        </div>
        <div className="flex items-center gap-3 mb-6">
          <div className="size-12 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Factory className="size-7 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{t("login.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("login.subtitle")}</p>
          </div>
        </div>

        <label className="block text-sm text-muted-foreground mb-2">
          {step === "id" ? t("login.employeeId") : t("login.pin")}
        </label>
        <div className="h-16 mb-4 rounded-md bg-input border border-border flex items-center justify-center text-3xl tracking-widest font-mono">
          {step === "pin" ? "•".repeat(pin.length) : id || <span className="text-muted-foreground/40 text-base">{t("login.enterId")}</span>}
        </div>

        {err && (
          <div className="mb-3 px-3 py-2 rounded-md bg-destructive/15 text-destructive text-sm border border-destructive/30">{err}</div>
        )}

        <div className="grid grid-cols-3 gap-2 mb-4">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => (k === "C" ? clear() : k === "back" ? back() : push(k))}
              className="h-16 text-2xl rounded-md bg-secondary hover:bg-accent active:scale-95 transition border border-border flex items-center justify-center"
            >
              {k === "back" ? <Delete className="size-6" /> : k}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {step === "pin" && (
            <Button variant="secondary" className="h-14 flex-1" onClick={() => { setStep("id"); setPin(""); setErr(null); }}>
              {t("login.back")}
            </Button>
          )}
          <Button className="h-14 flex-1 text-lg" disabled={busy || !value.trim()} onClick={submit}>
            {busy ? "..." : step === "id" ? t("login.next") : t("login.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
