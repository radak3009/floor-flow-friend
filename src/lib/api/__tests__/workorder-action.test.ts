import { describe, it, expect, vi } from "vitest";
import { performActionCore, type PerformActionDeps, type ActionInput } from "../workorder.logic";

const NOW = "2026-06-03T12:00:00.000Z";

function makeDeps(over: Partial<PerformActionDeps> = {}): PerformActionDeps {
  return {
    findDedupe: vi.fn(async () => null),
    fetchWorkOrder: vi.fn(async () => ({ statusNaloga: "Spreman" })),
    acquire: vi.fn(async () => ({ ok: true, currentStatus: "Spreman" })),
    release: vi.fn(async () => {}),
    updateStatus: vi.fn(async () => {}),
    createPromena: vi.fn(async () => {}),
    now: vi.fn(() => NOW),
    ...over,
  };
}

function input(over: Partial<ActionInput> = {}): ActionInput {
  return { radniNalogId: "recRN1", userId: "recU1", action: "start", ...over };
}

describe("performActionCore", () => {
  it("dedupe short-circuits without writes", async () => {
    const deps = makeDeps({ findDedupe: vi.fn(async () => "recExisting") });
    const res = await performActionCore(input({ clientOpId: "op-1" }), deps);
    expect(res).toEqual({ ok: true, statusNaloga: "U radu", deduped: true });
    expect(deps.fetchWorkOrder).not.toHaveBeenCalled();
    expect(deps.updateStatus).not.toHaveBeenCalled();
    expect(deps.createPromena).not.toHaveBeenCalled();
  });

  it("throws when work order is not found", async () => {
    const deps = makeDeps({ fetchWorkOrder: vi.fn(async () => null) });
    await expect(performActionCore(input(), deps)).rejects.toThrow(/nije pronađen/);
  });

  it("rejects illegal status transition with KONFLIKT prefix", async () => {
    const deps = makeDeps({ fetchWorkOrder: vi.fn(async () => ({ statusNaloga: "U radu" })) });
    await expect(performActionCore(input({ action: "start" }), deps)).rejects.toThrow(/^KONFLIKT:/);
    expect(deps.acquire).not.toHaveBeenCalled();
  });

  it("rejects when CAS acquire fails", async () => {
    const deps = makeDeps({
      acquire: vi.fn(async () => ({ ok: false, currentStatus: "Pauziran" })),
    });
    await expect(performActionCore(input(), deps)).rejects.toThrow(/Pauziran/);
    expect(deps.updateStatus).not.toHaveBeenCalled();
  });

  it("happy path: updates status, creates promena, uses now() fallback", async () => {
    const deps = makeDeps();
    const res = await performActionCore(input(), deps);
    expect(res).toEqual({ ok: true, statusNaloga: "U radu" });
    expect(deps.updateStatus).toHaveBeenCalledWith("recRN1", "U radu");
    expect(deps.createPromena).toHaveBeenCalledTimes(1);
    const rec = (deps.createPromena as any).mock.calls[0][0];
    expect(rec.start).toBe(NOW);
    expect(rec.pokretanje).toBe(true);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("rolls back lock if Airtable update fails", async () => {
    const updateStatus = vi.fn(async () => {
      throw new Error("airtable down");
    });
    const release = vi.fn(async () => {});
    const deps = makeDeps({ updateStatus, release });
    await expect(performActionCore(input(), deps)).rejects.toThrow(/airtable down/);
    expect(release).toHaveBeenCalledWith({
      radniNalogId: "recRN1",
      expected: "U radu",
      revertTo: "Spreman",
    });
  });

  it("wraps fetchWorkOrder errors as KONFLIKT", async () => {
    const deps = makeDeps({
      fetchWorkOrder: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    await expect(performActionCore(input(), deps)).rejects.toThrow(/^KONFLIKT:/);
  });

  it("stop transition writes kraj from now()", async () => {
    const deps = makeDeps({ fetchWorkOrder: vi.fn(async () => ({ statusNaloga: "U radu" })) });
    await performActionCore(input({ action: "stop" }), deps);
    const rec = (deps.createPromena as any).mock.calls[0][0];
    expect(rec.kraj).toBe(NOW);
    expect(rec.zatvaranje).toBe(true);
  });
});
