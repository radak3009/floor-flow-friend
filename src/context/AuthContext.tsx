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

    // Background refresh of permissions/role on app load. Fail-open on network errors.
    if (stored?.id) {
      const userId = stored.id;
      const baseline = stored;
      refreshSessionFn({ data: { userId } })
        .then((res) => {
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
          /* tiho ignorisati: zadrži postojeću sesiju */
        });
    }
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
