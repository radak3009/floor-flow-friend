import { useState } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useHydrated } from "@/hooks/useHydrated";
import { useOutboxPendingCount } from "@/hooks/useOutbox";
import { Wifi, WifiOff, Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import OutboxDrawer from "./OutboxDrawer";

/**
 * Indikator stanja konekcije + outbox red čekanja.
 * - Zeleno: online, nema čekanja
 * - Žuto: offline (prikazani su poslednji sinhronizovani podaci)
 * - Sa brojem: ima N stavki na čekanju (klik otvara drawer)
 */
export default function OfflineBadge({ className = "" }: { className?: string }) {
  const hydrated = useHydrated();
  const online = useOnlineStatus();
  const pending = useOutboxPendingCount();
  const [open, setOpen] = useState(false);

  if (!hydrated) return <span className={className} aria-hidden />;

  const hasPending = pending > 0;
  const showOffline = !online;

  // Stanje: ima stavki na čekanju → klikabilan badge
  if (hasPending) {
    return (
      <>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className={`inline-flex items-center gap-1.5 h-9 px-2 rounded-md text-xs font-medium cursor-pointer ${
                  showOffline
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    : "bg-primary/15 text-primary"
                } ${className}`}
                aria-label={`Stavke na čekanju: ${pending}`}
              >
                {showOffline ? <WifiOff className="size-4" /> : <Clock className="size-4" />}
                <span className="tabular-nums">{pending}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {showOffline
                ? `Offline · ${pending} stavki čeka da bude poslato`
                : `${pending} stavki se sinhronizuje`}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <OutboxDrawer open={open} onOpenChange={setOpen} />
      </>
    );
  }

  if (online) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={`inline-flex items-center justify-center size-9 rounded-md text-emerald-600 ${className}`}
              aria-label="Online"
            >
              <Wifi className="size-4" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Online — podaci su sveži</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1.5 h-9 px-2 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 text-xs font-medium ${className}`}
            aria-label="Offline"
          >
            <WifiOff className="size-4" />
            <span className="hidden sm:inline">Offline</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Nema interneta — prikazani su poslednji sinhronizovani podaci.
          <br />
          Nove akcije se snimaju lokalno i biće poslate kad se konekcija vrati.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
