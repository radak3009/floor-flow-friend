import { createFileRoute, Link } from "@tanstack/react-router";
import { Users, ShieldCheck, ChevronRight, Database, Smartphone } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/_auth/podesavanja/")({
  component: PodesavanjaIndex,
});

function PodesavanjaIndex() {
  const { user } = useAuth();
  const role = (user?.roleName ?? "").trim().toLowerCase();
  const isSuper = role === "super admin";
  const isAdmin = role === "admin" || isSuper;
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <h1 className="hidden lg:block text-xl font-semibold uppercase tracking-wide mb-6">Podešavanja</h1>

      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3 text-center">
        Podešavanja sistema
      </div>
      <div className="space-y-3">
        <SettingCard
          to="/podesavanja/korisnici"
          icon={<Users className="size-5" />}
          title="Korisnici"
          subtitle="Aktivacija/deaktivacija naloga i dodela uloga"
        />
        <SettingCard
          to="/podesavanja/role"
          icon={<ShieldCheck className="size-5" />}
          title="Role i dozvole"
          subtitle="Upravljanje dozvolama po ulogama"
        />
        {isSuper && (
          <SettingCard
            to="/podesavanja/airtable"
            icon={<Database className="size-5" />}
            title="Airtable baza"
            subtitle="Poveži drugu Airtable bazu (PAT + Base ID) i regeneriši mapu"
          />
        )}
        {isAdmin && (
          <SettingCard
            to="/podesavanja/pwa"
            icon={<Smartphone className="size-5" />}
            title="PWA aplikacija"
            subtitle="Ime i ikonica koja se vidi na mobilnim telefonima i tabletima"
          />
        )}
      </div>
    </div>
  );
}

function SettingCard({
  to,
  icon,
  title,
  subtitle,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 rounded-xl border border-border bg-card p-5 hover:bg-muted/40 transition-colors"
    >
      <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground truncate">{subtitle}</div>
      </div>
      <ChevronRight className="size-5 text-muted-foreground" />
    </Link>
  );
}
