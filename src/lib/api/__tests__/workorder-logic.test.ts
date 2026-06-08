import { describe, it, expect } from "vitest";
import {
  VALID_TRANSITIONS,
  STATUS_BY_ACTION,
  validate,
  buildPromenaRecord,
  type ActionInput,
} from "../workorder.logic";

const NOW = "2026-01-01T10:00:00.000Z";

function base(over: Partial<ActionInput> = {}): ActionInput {
  return {
    radniNalogId: "recRN1",
    userId: "recU1",
    action: "start",
    ...over,
  };
}

describe("VALID_TRANSITIONS", () => {
  it("matches the documented state machine", () => {
    expect(VALID_TRANSITIONS).toEqual({
      start: ["Potvrđen", "Spreman", "Upit"],
      pause: ["U radu"],
      resume: ["Pauziran"],
      stop: ["U radu", "Pauziran"],
    });
    expect(STATUS_BY_ACTION).toEqual({
      start: "U radu",
      pause: "Pauziran",
      resume: "U radu",
      stop: "Završen",
    });
  });
});

describe("validate", () => {
  it("throws on missing radniNalogId", () => {
    expect(() => validate(base({ radniNalogId: "" }))).toThrow(/radniNalogId/);
  });
  it("throws on unknown action", () => {
    expect(() => validate(base({ action: "bogus" as any }))).toThrow(/Nepoznata/);
  });
  it("throws on invalid startTime", () => {
    expect(() => validate(base({ startTime: "not-a-date" }))).toThrow(/startTime/);
  });
  it("normalizes empty startTime to undefined", () => {
    const out = validate(base({ startTime: "" }));
    expect(out.startTime).toBeUndefined();
  });
  it("accepts a valid ISO startTime", () => {
    const out = validate(base({ startTime: NOW }));
    expect(out.startTime).toBe(NOW);
  });
});

describe("buildPromenaRecord", () => {
  it("start without startTime falls back to now", () => {
    const r = buildPromenaRecord(base({ action: "start" }), NOW);
    expect(r.start).toBe(NOW);
    expect(r.pokretanje).toBe(true);
    expect(r.pauziranje).toBe(false);
    expect(r.kraj).toBeUndefined();
  });
  it("start with startTime uses provided value", () => {
    const r = buildPromenaRecord(base({ action: "start", startTime: "2025-12-31T09:00:00.000Z" }), NOW);
    expect(r.start).toBe("2025-12-31T09:00:00.000Z");
  });
  it("resume with startTime sets start", () => {
    const r = buildPromenaRecord(base({ action: "resume", startTime: NOW }), NOW);
    expect(r.start).toBe(NOW);
    expect(r.reaktivacija).toBe(true);
  });
  it("resume without startTime does NOT set start", () => {
    const r = buildPromenaRecord(base({ action: "resume" }), NOW);
    expect(r.start).toBeUndefined();
    expect(r.reaktivacija).toBe(true);
  });
  it("stop sets kraj=now and zatvaranje=true", () => {
    const r = buildPromenaRecord(base({ action: "stop" }), NOW);
    expect(r.kraj).toBe(NOW);
    expect(r.start).toBeUndefined();
    expect(r.zatvaranje).toBe(true);
  });
  it("pause sets neither start nor kraj", () => {
    const r = buildPromenaRecord(base({ action: "pause" }), NOW);
    expect(r.start).toBeUndefined();
    expect(r.kraj).toBeUndefined();
    expect(r.pauziranje).toBe(true);
  });
  it("passes through komentar and clientOpId", () => {
    const r = buildPromenaRecord(
      base({ action: "start", komentar: "test", clientOpId: "op-1" }),
      NOW,
    );
    expect(r.komentar).toBe("test");
    expect(r.__extraFields).toEqual({ clientOpId: "op-1" });
  });
  it("links radniNalog and kreiraola as arrays", () => {
    const r = buildPromenaRecord(base(), NOW);
    expect(r.radniNalog).toEqual(["recRN1"]);
    expect(r.kreiraola).toEqual(["recU1"]);
  });
});
