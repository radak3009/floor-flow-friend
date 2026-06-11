import { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MES Shop Floor" },
      { name: "description", content: "MES Shop Floor — unos škarta, inspekcije kvaliteta i downtime, direktno sa tableta ili mobilnog. Jednostavno. Precizno. Odmah." },
      { name: "author", content: "MES" },
      { property: "og:title", content: "MES Shop Floor" },
      { property: "og:description", content: "MES Shop Floor — unos škarta, inspekcije kvaliteta i downtime, direktno sa tableta ili mobilnog. Jednostavno. Precizno. Odmah." },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "MES Shop Floor" },
      { name: "twitter:description", content: "MES Shop Floor — unos škarta, inspekcije kvaliteta i downtime, direktno sa tableta ili mobilnog. Jednostavno. Precizno. Odmah." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/fG198uDXRoaQt88DzQJOcxJQzL63/social-images/social-1779439925250-mes_shopfloor_social_image.webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/fG198uDXRoaQt88DzQJOcxJQzL63/social-images/social-1779439925250-mes_shopfloor_social_image.webp" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#1f2937" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "MES" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/api/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const PREHYDRATE_SCRIPT = `(function(){try{var t=localStorage.getItem("app.theme")||"dark";if(t==="dark")document.documentElement.classList.add("dark");document.documentElement.style.colorScheme=t;var l=localStorage.getItem("app.lang");if(l==="sr"||l==="en")document.documentElement.setAttribute("lang",l);}catch(e){}})();`;

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sr">
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREHYDRATE_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

import { AuthProvider } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createIdbPersister, OFFLINE_CACHE_MAX_AGE_MS } from "@/lib/offline/persister";
import { registerServiceWorker } from "@/lib/offline/registerSW";
import { useState, useEffect, useMemo } from "react";
import { ThemeProvider } from "@/context/ThemeContext";
import { I18nextProvider, useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";

function HtmlLangSync() {
  const { i18n: i18nInstance } = useTranslation();
  useEffect(() => {
    if (typeof document !== "undefined") {
      const lang = i18nInstance.language?.startsWith("en") ? "en" : "sr";
      document.documentElement.setAttribute("lang", lang);
    }
  }, [i18nInstance.language]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // Stabilan userBuster — pročitan sinhrono pri prvom renderu da ne bi
  // promena "anon" → userId restartovala persister restore.
  const [userBuster] = useState<string>(() => {
    if (typeof window === "undefined") return "anon";
    try {
      const raw = localStorage.getItem("mes_session_v2");
      const id = raw ? JSON.parse(raw)?.id : null;
      return typeof id === "string" && id ? id : "anon";
    } catch {
      return "anon";
    }
  });
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Persister mora biti stabilan kroz rendere; svaki novi identitet
  // restartuje IndexedDB restore i zaglavljuje query-je (isRestoring).
  // NAPOMENA: PersistQueryClientProvider se SADA renderuje uvek (i na
  // serveru) — restore se ionako pokreće tek u useEffect-u (samo browser),
  // a jedinstven provider eliminiše unmount/remount celog stabla
  // (QueryClientProvider → PersistQueryClientProvider swap) koji je
  // restartovao AuthProvider i restore i bio izvor "zaglavljenih" query-ja.
  const persister = useMemo(() => createIdbPersister(), []);
  const buildId = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
  const persistOptions = useMemo(
    () => ({
      persister,
      maxAge: OFFLINE_CACHE_MAX_AGE_MS,
      buster: `${buildId}:${userBuster}`,
      dehydrateOptions: {
        shouldDehydrateQuery: (q: { queryKey: unknown }) => {
          const key0 = Array.isArray(q.queryKey) ? q.queryKey[0] : q.queryKey;
          // Live dashboard se uvek refetch-uje; ne persistuj ga da bi restore bio brz.
          return key0 !== "dashboard";
        },
      },
    }),
    [persister, buildId, userBuster],
  );

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={persistOptions}
        >
          <AuthProvider>
            <HtmlLangSync />
            <Outlet />
            <Toaster position="top-center" richColors />
          </AuthProvider>
        </PersistQueryClientProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
