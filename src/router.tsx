import { QueryClient, QueryCache } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const SESSION_KEY = "mes_session_v2";

/** Greška iz `requirePinSession` middleware-a (nevažeća/istekla sesija). */
function isAuthSessionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return msg.includes("Unauthorized") || msg.includes("nevažeća ili istekla sesija");
}

function getErrStatus(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as { status?: number; statusCode?: number; response?: { status?: number } };
    return e.status ?? e.statusCode ?? e.response?.status;
  }
  return undefined;
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (err) => {
        // Globalna zaštita: ako je PIN sesija nevažeća/istekla, korisnik je
        // "ulogovan" lokalno ali svi zaštićeni pozivi padaju → podaci se
        // nikad ne učitaju. Umesto tihog vrtenja, očisti sesiju i vrati na
        // login ekran da se korisnik ponovo prijavi.
        if (typeof window === "undefined" || !isAuthSessionError(err)) return;
        try {
          if (!localStorage.getItem(SESSION_KEY)) return;
          localStorage.removeItem(SESSION_KEY);
        } catch { /* noop */ }
        window.location.assign("/");
      },
    }),
    defaultOptions: {
      queries: {
        // Drži keš 24h da preživi reload i da se može učitati iz IndexedDB offline
        gcTime: 24 * 60 * 60 * 1000,
        staleTime: 30_000,
        retry: (count, err) => {
          // Nevažeća/istekla sesija se ne popravlja ponavljanjem — ne retry-uj
          // (QueryCache.onError odmah vodi na ponovnu prijavu).
          if (isAuthSessionError(err)) return false;
          const status = getErrStatus(err);
          if (status === 401 || status === 403) return count < 4;
          return count < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
