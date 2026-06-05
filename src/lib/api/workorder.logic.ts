// Pure, testable workorder transition logic. No I/O, no Airtable imports.

export type Action = "start" | "pause" | "resume" | "stop";

export const VALID_TRANSITIONS: Record<Action, string[]> = {
  start: ["Na čekanju", "Spreman", "Nacrt"],
  pause: ["U radu"],
  resume: ["Pauziran"],
  stop: ["U radu", "Pauziran"],
};

export const STATUS_BY_ACTION: Record<Action, string> = {
  start: "U radu",
  pause: "Pauziran",
  resume: "U radu",
  stop: "Završen",
};

export interface ActionInput {
  radniNalogId: string;
  resursId?: string;
  userId: string;
  komentar?: string;
  startTime?: string;
  action: Action;
  clientOpId?: string;
}

export function validate(input: ActionInput): ActionInput {
  if (!input.radniNalogId) throw new Error("radniNalogId je obavezan");
  if (!["start", "pause", "resume", "stop"].includes(input.action))
    throw new Error("Nepoznata akcija");
  if (input.startTime !== undefined && input.startTime !== null && input.startTime !== "") {
    if (typeof input.startTime !== "string" || isNaN(Date.parse(input.startTime))) {
      throw new Error("startTime mora biti validan ISO datetime");
    }
  } else {
    input.startTime = undefined;
  }
  return input;
}

/** Build the PromeneNaloga record for a given action. Pure. */
export function buildPromenaRecord(input: ActionInput, nowIso: string): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    radniNalog: [input.radniNalogId],
    kreiraola: [input.userId],
    pokretanje: input.action === "start",
    pauziranje: input.action === "pause",
    reaktivacija: input.action === "resume",
    zatvaranje: input.action === "stop",
  };
  if (input.komentar) rec.komentar = input.komentar;
  if (input.action === "start") rec.start = input.startTime || nowIso;
  if (input.action === "resume" && input.startTime) rec.start = input.startTime;
  if (input.action === "stop") rec.kraj = nowIso;
  if (input.clientOpId) rec.__extraFields = { clientOpId: input.clientOpId };
  return rec;
}

export function conflictMessage(currentStatus: string): string {
  return `KONFLIKT: nalog je u međuvremenu promenio status (${currentStatus || "(nepoznat)"}). Osveži prikaz.`;
}

export interface PerformActionDeps {
  findDedupe(clientOpId: string): Promise<string | null>;
  fetchWorkOrder(id: string): Promise<{ statusNaloga?: string } | null>;
  acquire(args: {
    radniNalogId: string;
    fromStatuses: string[];
    toStatus: string;
    userId: string;
    airtableStatus: string;
  }): Promise<{ ok: boolean; currentStatus: string }>;
  release(args: { radniNalogId: string; expected: string; revertTo: string }): Promise<void>;
  updateStatus(id: string, status: string): Promise<void>;
  createPromena(record: Record<string, unknown>): Promise<void>;
  now(): string;
}

export interface PerformResult {
  ok: true;
  statusNaloga: string;
  deduped?: true;
}

export async function performActionCore(
  input: ActionInput,
  deps: PerformActionDeps,
): Promise<PerformResult> {
  const newStatus = STATUS_BY_ACTION[input.action];
  const allowedFrom = VALID_TRANSITIONS[input.action];

  if (input.clientOpId) {
    const existing = await deps.findDedupe(input.clientOpId);
    if (existing) return { ok: true, statusNaloga: newStatus, deduped: true };
  }

  let wo: { statusNaloga?: string } | null;
  try {
    wo = await deps.fetchWorkOrder(input.radniNalogId);
  } catch {
    throw new Error("KONFLIKT: status naloga trenutno nedostupan. Pokušajte ponovo.");
  }
  if (!wo) throw new Error("Radni nalog nije pronađen");

  const airtableStatus = wo.statusNaloga ?? "";
  if (!allowedFrom.includes(airtableStatus)) {
    throw new Error(conflictMessage(airtableStatus));
  }

  const acq = await deps.acquire({
    radniNalogId: input.radniNalogId,
    fromStatuses: allowedFrom,
    toStatus: newStatus,
    userId: input.userId,
    airtableStatus,
  });
  if (!acq.ok) throw new Error(conflictMessage(acq.currentStatus));

  try {
    await deps.updateStatus(input.radniNalogId, newStatus);
    const record = buildPromenaRecord(input, deps.now());
    await deps.createPromena(record);
  } catch (e) {
    await deps
      .release({
        radniNalogId: input.radniNalogId,
        expected: newStatus,
        revertTo: airtableStatus,
      })
      .catch(() => {});
    throw e;
  }

  return { ok: true, statusNaloga: newStatus };
}
