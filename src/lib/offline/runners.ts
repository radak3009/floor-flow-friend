/**
 * Registracija runner-a za outbox tipove.
 * Mapira string tip operacije → poziv server fn.
 *
 * Pozvati JEDNOM iz klijentskog koda (npr. u _auth layout-u),
 * prosleđujući QueryClient za invalidaciju keša posle uspešnog flush-a.
 */
import type { QueryClient } from "@tanstack/react-query";
import { registerRunner, setOnSuccess, initOutbox } from "./outbox";
import {
  startWorkOrderFn,
  pauseWorkOrderFn,
  resumeWorkOrderFn,
  logScrapFn,
  stopWorkOrderWithBatchFn,
} from "@/lib/api/workorder.functions";
import { logInspectionFn } from "@/lib/api/inspection.functions";
import { logDowntimeFn } from "@/lib/api/downtime.functions";

let installed = false;

export function installOutboxRunners(queryClient: QueryClient) {
  if (installed) return;
  installed = true;

  // Sve runner funkcije primaju (payload, clientOpId) i pozivaju server fn
  registerRunner("startWorkOrder", (payload, clientOpId) =>
    startWorkOrderFn({ data: { ...payload, clientOpId } }),
  );
  registerRunner("pauseWorkOrder", (payload, clientOpId) =>
    pauseWorkOrderFn({ data: { ...payload, clientOpId } }),
  );
  registerRunner("resumeWorkOrder", (payload, clientOpId) =>
    resumeWorkOrderFn({ data: { ...payload, clientOpId } }),
  );
  registerRunner("stopWorkOrderWithBatch", (payload, clientOpId) =>
    stopWorkOrderWithBatchFn({ data: { ...payload, clientOpId } }),
  );
  registerRunner("logScrap", (payload, clientOpId) =>
    logScrapFn({ data: { ...payload, clientOpId } }),
  );
  registerRunner("logInspection", (payload, clientOpId) =>
    logInspectionFn({ data: { ...payload, clientOpId } }),
  );
  registerRunner("logDowntime", (payload, clientOpId) =>
    logDowntimeFn({ data: { ...payload, clientOpId } }),
  );

  setOnSuccess(() => {
    // Posle bilo koje uspešne operacije osveži ključne kešove
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["wo-history"] });
    queryClient.invalidateQueries({ queryKey: ["wo-inspections"] });
    queryClient.invalidateQueries({ queryKey: ["history"] });
    queryClient.invalidateQueries({ queryKey: ["active-downtime"] });
    queryClient.invalidateQueries({ queryKey: ["available-wo"] });
  });

  initOutbox();
}
