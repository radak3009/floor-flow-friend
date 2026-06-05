// Registracija service worker-a sa zaštitama:
//   - Samo u browseru
//   - Nikad u iframe-u (Lovable editor preview)
//   - Nikad na preview/lovableproject hostovima
//   - Samo u production build-u
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const isInIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host === "localhost" ||
    host === "127.0.0.1";

  if (isInIframe || isPreviewHost) {
    // Očisti stare registracije u preview/iframe kontekstu
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
    return;
  }

  // Registruj na sledećem idle eventu da ne blokira boot
  const register = () => {
    const v = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(v)}`, { scope: "/" })
      .catch((err) => {
        // Tiho — SW je progressive enhancement
        console.warn("[SW] registracija nije uspela", err);
      });
  };

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
