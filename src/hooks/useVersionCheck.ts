import { useCallback, useEffect, useRef, useState } from "react";

const BASE_INTERVAL_MS = 60_000;
const VERSION_STORAGE_KEY = "mes_seen_build_id_v1";

export function useVersionCheck(): {
  updateAvailable: boolean;
  latestBuildId: string | null;
  acknowledgeLatestVersion: () => void;
} {
  const [latestBuildId, setLatestBuildId] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const inFlight = useRef(false);
  const seenBuildId = useRef<string | null>(null);

  const acknowledgeLatestVersion = useCallback(() => {
    if (!latestBuildId || typeof window === "undefined") return;
    try {
      localStorage.setItem(VERSION_STORAGE_KEY, latestBuildId);
      seenBuildId.current = latestBuildId;
      setUpdateAvailable(false);
    } catch {
      // Ako storage nije dostupan, cache-busted reload ipak prolazi.
    }
  }, [latestBuildId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function check() {
      if (inFlight.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/public/version", {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        const next = data?.buildId;
        if (!next || cancelled) return;
        setLatestBuildId(next);
        let remembered = seenBuildId.current;
        try {
          remembered = remembered ?? localStorage.getItem(VERSION_STORAGE_KEY);
          if (!remembered) {
            localStorage.setItem(VERSION_STORAGE_KEY, next);
            seenBuildId.current = next;
            return;
          }
        } catch {
          remembered = next;
        }
        seenBuildId.current = remembered;
        if (next !== remembered) setUpdateAvailable(true);
      } catch {
        // Tiho ignoriši mrežne greške; pokušaj kasnije.
      } finally {
        inFlight.current = false;
      }
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      const jitter = Math.floor(Math.random() * 5000);
      timer = setTimeout(async () => {
        await check();
        if (!cancelled) schedule();
      }, BASE_INTERVAL_MS + jitter);
    }

    void check();
    schedule();

    const onFocus = () => void check();
    const onVisibility = () => {
      if (!document.hidden) void check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { updateAvailable, latestBuildId, acknowledgeLatestVersion };
}
