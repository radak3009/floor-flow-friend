import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useServerFn } from "@tanstack/react-start";
import { logoutFn } from "@/lib/api/auth.functions";
import { Factory, LayoutDashboard, MonitorPlay, History, Settings, LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import NotificationBell from "@/components/comments/NotificationBell";
import OfflineBadge from "@/components/offline/OfflineBadge";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { installOutboxRunners } from "@/lib/offline/runners";
import { useTranslation } from "react-i18next";
import ThemeToggle from "@/components/ThemeToggle";

export const Route = createFileRoute("/_auth")({ component: AuthLayout });

const NAV = [
  { to: "/shop-floor", labelKey: "nav.shopFloor", titleKey: "nav.shopFloor", icon: LayoutDashboard, perm: "viewAssignedMachines" as const },
  { to: "/monitoring", labelKey: "nav.monitoring", titleKey: "nav.monitoring", icon: MonitorPlay, perm: "viewAllFactoryMachines" as const },
  { to: "/istorija", labelKey: "nav.istorija", titleKey: "nav.istorija", icon: History, perm: "viewHistory" as const },
  { to: "/podesavanja", labelKey: "nav.settings", titleKey: "nav.settings", icon: Settings, perm: "manageUsers" as const },
];

function AuthLayout() {
  const { t } = useTranslation();
  const { user, ready, logout } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const callLogout = useServerFn(logoutFn);
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { updateAvailable, latestBuildId, acknowledgeLatestVersion } = useVersionCheck();
  const [updateBusy, setUpdateBusy] = useState(false);

  // Offline outbox runners — registracija je idempotentna
  useEffect(() => { installOutboxRunners(queryClient); }, [queryClient]);

  async function hardPurgeCaches() {
    try {
      if (typeof window !== "undefined" && "caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch { /* noop */ }
    try {
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => r.unregister())));
      }
    } catch { /* noop */ }
  }

  async function handleVersionReload() {
    setUpdateBusy(true);
    try { if (user) await callLogout({ data: { prijavaId: user.prijavaId } }); } catch { /* noop */ }
    try { logout(); } catch { /* noop */ }
    await hardPurgeCaches();
    acknowledgeLatestVersion();
    const v = latestBuildId ?? String(Date.now());
    window.location.replace(`/?v=${encodeURIComponent(v)}`);
  }

  const visible = useMemo(() => {
    if (!user) return [];
    return NAV.filter((n) => user.permissions[n.perm] || (n.to === "/shop-floor" && user.permissions.viewAllFactoryMachines));
  }, [user]);

  const currentTitle = useMemo(() => {
    const match = NAV.find((n) => pathname === n.to || pathname.startsWith(n.to + "/"));
    return match ? t(match.titleKey) : "";
  }, [pathname, t]);

  useEffect(() => {
    if (ready && !user) navigate({ to: "/" });
  }, [ready, user, navigate]);

  // Close drawer when route changes
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  if (!ready || !user) return null;

  async function handleLogout() {
    try { await callLogout({ data: { prijavaId: user!.prijavaId } }); } catch { /* noop */ }
    logout();
    navigate({ to: "/" });
  }

  const NavList = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex-1 p-2 space-y-1">
      {visible.map((n) => {
        const active = pathname === n.to || pathname.startsWith(n.to + "/");
        return (
          <Link
            key={n.to}
            to={n.to}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 h-11 rounded-md text-sm hover:bg-sidebar-accent ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
          >
            <n.icon className="size-5" />
            {t(n.labelKey)}
          </Link>
        );
      })}
    </nav>
  );

  const SidebarInner = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      <div className="p-4 flex items-center gap-2 border-b border-sidebar-border">
        <div className="size-9 rounded-md bg-primary/15 flex items-center justify-center">
          <Factory className="size-5 text-primary" />
        </div>
        <div>
          <div className="font-semibold leading-tight">MES Shop Floor</div>
          <div className="text-xs text-muted-foreground">{user.roleName}</div>
        </div>
      </div>
      <NavList onNavigate={onNavigate} />
      <div className="p-3 border-t border-sidebar-border">
        <div className="text-xs text-muted-foreground mb-1">{t("nav.loggedInAs")}</div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="text-sm font-medium truncate">{user.imeIPrezime}</div>
          <div className="flex items-center gap-1">
            <OfflineBadge />
            <NotificationBell />
            <ThemeToggle />
          </div>
        </div>
        <div className="text-xs text-muted-foreground mb-3">ID {user.idZaposlenog}</div>
        <Button variant="secondary" className="w-full justify-start" onClick={handleLogout}>
          <LogOut className="size-4 mr-2" /> {t("nav.logout")}
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex w-full bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col">
        <SidebarInner />
      </aside>

      {/* Mobile/tablet drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-72 p-0 bg-sidebar text-sidebar-foreground flex flex-col">
          <SheetTitle className="sr-only">{t("nav.navigation")}</SheetTitle>
          <SidebarInner onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile/tablet top app bar */}
        <header className="lg:hidden sticky top-0 z-30 h-14 flex items-center gap-2 px-3 border-b border-border bg-background/95 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("nav.openMenu")}
          >
            <Menu className="size-5" />
          </Button>
          <div className="flex-1 text-center font-semibold tracking-wide truncate">
            {currentTitle}
          </div>
          <div className="hidden sm:flex flex-col items-end mr-1 min-w-0">
            <div className="text-xs font-medium truncate max-w-[160px]">{user.imeIPrezime}</div>
            <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">{user.roleName}</div>
          </div>
          <OfflineBadge />
          <NotificationBell />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={handleLogout}
            aria-label={t("nav.logout")}
          >
            <LogOut className="size-5" />
          </Button>
        </header>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <AlertDialog open={updateAvailable}>
        <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("nav.newVersionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("nav.newVersionDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              disabled={updateBusy}
              onClick={(e) => { e.preventDefault(); void handleVersionReload(); }}
            >
              {updateBusy ? t("nav.loadingShort") : t("nav.loginAgain")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
