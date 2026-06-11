import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refreshSessionFn } from "@/lib/api/auth.functions";


export interface UserPermissions {
  viewAssignedMachines: boolean;
  viewAllFactoryMachines: boolean;
  startWorkOrder: boolean;
  pauseWorkOrder: boolean;
  resumeWorkOrder: boolean;
  stopWorkOrder: boolean;
  resetStart: boolean;
  logScrap: boolean;
  deleteScrap: boolean;
  logDowntime: boolean;
  confirmBatch: boolean;
  performInspection: boolean;
  viewHistory: boolean;
  manageUsers: boolean;
  manageSettings: boolean;
  manageReasonCodes: boolean;
  viewReports: boolean;
  manageFactoryScope: boolean;
  canComment: boolean;
}

export interface SessionUser {
  id: string;
  idZaposlenog: string;
  imeIPrezime: string;
  roleId: string;
  roleName: string;
  prijavaId: string;
  permissions: UserPermissions;
  token?: string;
}

interface AuthContextType {
  user: SessionUser | null;
  login: (u: SessionUser) => void;
  logout: () => void;
  ready: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);
const SESSION_KEY = "mes_session_v2";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: SessionUser | null = null;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(SESSION_KEY) : null;
      if (raw) {
        stored = JSON.parse(raw) as SessionUser;
        setUser(stored);
      }
    } catch {
      /* noop */
    }
    setReady(true);

    // Sliding refresh sesije/permisija. Fail-open na mrežne greške.
    // Pored inicijalnog refresh-a na mount, osvežavamo i periodično + na
    // povratak fokusa: fabrički tableti stoje ulogovani danima, a PIN
    // session token važi 12h — bez ovoga token istekne dok je aplikacija
    // otvorena i svi zaštićeni server fn pozivi počnu tiho da padaju
    // ("podaci se ne učitavaju" bez odjave).
    let cancelled = false;
    let lastRefresh = 0;
    const MIN_GAP_MS = 10 * 60 * 1000; // ne češće od 10 min
    const INTERVAL_MS = 4 * 60 * 60 * 1000; // a najmanje na 4h

    const doRefresh = () => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastRefresh < MIN_GAP_MS) return;
      lastRefresh = now;

      let current: SessionUser | null = null;
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        current = raw ? (JSON.parse(raw) as SessionUser) : null;
      } catch {
        /* noop */
      }
      if (!current?.id) return;
      const baseline = current;

      refreshSessionFn({ data: { userId: baseline.id } })
        .then((res) => {
          if (cancelled) return;
          if (res.invalid) {
            try { localStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
            setUser(null);
            return;
          }
          const merged: SessionUser = {
            ...baseline,
            roleId: res.roleId,
            roleName: res.roleName,
            imeIPrezime: res.imeIPrezime || baseline.imeIPrezime,
            permissions: res.permissions,
            token: (res as any).token ?? baseline.token,
          };
          try { localStorage.setItem(SESSION_KEY, JSON.stringify(merged)); } catch { /* noop */ }
          setUser(merged);
        })
        .catch(() => {
          // tiho ignorisati: zadrži postojeću sesiju, pokušaće ponovo
          lastRefresh = 0;
        });
    };

    doRefresh();
    const interval = window.setInterval(doRefresh, INTERVAL_MS);
    const onFocus = () => doRefresh();
    const onVisibility = () => { if (!document.hidden) doRefresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const login = (u: SessionUser) => {
    // Očisti samo in-memory keš. IDB persister keš se odbacuje preko
    // buster-a (sadrži user.id i BUILD_ID); manuelno brisanje IDB ključa
    // se sudara sa persister restore/save i izaziva zaglavljen restore.
    try { queryClient.clear(); } catch { /* noop */ }
    localStorage.setItem(SESSION_KEY, JSON.stringify(u));
    setUser(u);
  };

  const logout = () => {
    try { queryClient.clear(); } catch { /* noop */ }
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, login, logout, ready }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
