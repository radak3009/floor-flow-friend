import { describe, it, expect } from "vitest";
import { parseTrajanjeToMin, computeKpis, mergeZastoji } from "../history.logic";

describe("parseTrajanjeToMin", () => {
  it("parses days, hours, minutes", () => {
    expect(parseTrajanjeToMin("2d 3h 15min")).toBe(2 * 24 * 60 + 3 * 60 + 15);
  });
  it("parses minutes only", () => {
    expect(parseTrajanjeToMin("45min")).toBe(45);
  });
  it("parses hours only", () => {
    expect(parseTrajanjeToMin("1h")).toBe(60);
  });
  it("returns 0 for empty/undefined", () => {
    expect(parseTrajanjeToMin("")).toBe(0);
    expect(parseTrajanjeToMin(undefined)).toBe(0);
  });
  it("returns 0 for unparseable input", () => {
    expect(parseTrajanjeToMin("xyz")).toBe(0);
  });
});

describe("computeKpis", () => {
  it("sums production, skart and counts RN", () => {
    const k = computeKpis({
      radniNalozi: [
        { ispravnoProizvedeno: 100, skart: 5 },
        { ispravnoProizvedeno: 50, skart: 0 },
        {},
      ],
      zastoji: [],
      skart: [{ kolicina: 7 }, { kolicina: 3 }],
    });
    expect(k.radniNalozi).toBe(3);
    expect(k.ukupnoProiz).toBe(150);
    expect(k.ukupnoSkart).toBe(5 + 7 + 3);
    expect(k.zastojiTotalMin).toBe(0);
    expect(k.zastojiCount).toBe(0);
  });

  it("includes orphan zastoji (without brojNaloga) in totals — regression", () => {
    const k = computeKpis({
      radniNalozi: [],
      zastoji: [
        { id: "z1", trajanjeZastoja: "30min", brojNaloga: "RN-1" },
        { id: "z2", trajanjeZastoja: "1h 15min" }, // orphan: no brojNaloga
        { id: "z3", trajanjeZastoja: "2d" },
      ],
      skart: [],
    });
    expect(k.zastojiCount).toBe(3);
    expect(k.zastojiTotalMin).toBe(30 + 75 + 2 * 24 * 60);
  });
});

describe("mergeZastoji", () => {
  it("merges linked + orphan, dedupes by id, sorts by start desc", () => {
    const linked = [
      { id: "a", start: "2026-01-01T08:00:00Z" },
      { id: "b", start: "2026-01-03T08:00:00Z" },
    ];
    const orphan = [
      { id: "b", start: "2026-01-03T08:00:00Z" }, // dup
      { id: "c", start: "2026-01-02T08:00:00Z" },
    ];
    const merged = mergeZastoji(linked, orphan);
    expect(merged.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps orphan-only rows", () => {
    const merged = mergeZastoji<{ id: string; start?: string }>([], [{ id: "x", start: "2026-01-01T00:00:00Z" }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("x");
  });
});
