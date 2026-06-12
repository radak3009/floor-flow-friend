import { createStart, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { attachPinSession } from "@/lib/auth/pin-session-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    // ServerFn RPC pozivi (/_serverFn/...): propusti originalnu grešku da je
    // TanStack Start serijalizuje klijentu — React Query tako dobija PRAVU
    // poruku (npr. "Unauthorized: nevažeća ili istekla sesija") umesto
    // generičke HTML 500 stranice. HTML stranica greške ostaje samo za
    // navigacione/SSR zahteve.
    let isServerFnCall = false;
    try {
      const req = getRequest();
      isServerFnCall = !!req && new URL(req.url).pathname.startsWith("/_serverFn");
    } catch {
      /* noop */
    }
    if (isServerFnCall) throw error;
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, attachPinSession],
  requestMiddleware: [errorMiddleware],
}));
