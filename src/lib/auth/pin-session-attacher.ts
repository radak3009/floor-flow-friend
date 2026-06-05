/**
 * Client fn middleware: čita PIN session token iz localStorage
 * (`mes_session_v2.token`) i šalje ga kao `X-PIN-Session: Bearer ...`
 * zaglavlje uz svaki server fn poziv.
 *
 * Koristimo poseban header (a ne `Authorization`) da ne dođe u sukob
 * sa Supabase `attachSupabaseAuth` middleware-om koji već koristi
 * `Authorization: Bearer <supabase-jwt>` za interne potrebe.
 */
import { createMiddleware } from "@tanstack/react-start";

const SESSION_KEY = "mes_session_v2";

export const attachPinSession = createMiddleware({ type: "function" }).client(async ({ next }) => {
  if (typeof window === "undefined") return next();
  let token: string | undefined;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.token === "string" && parsed.token) {
        token = parsed.token;
      }
    }
  } catch {
    /* noop */
  }
  if (!token) return next();
  return next({ headers: { "X-PIN-Session": `Bearer ${token}` } });
});
