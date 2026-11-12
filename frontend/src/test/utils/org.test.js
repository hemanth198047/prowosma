import { describe, it, expect } from "vitest";
import { buildTree, managerChain, descendantIds, teamSize, localTime, searchVisible, allocationByEmail, initials } from "../../utils/org";

const P = (id, managerId, extra = {}) => ({ id, name: id.toUpperCase(), email: `${id}@x.com`, managerId, ...extra });
const people = [P("ceo", null), P("vp", "ceo"), P("lead", "vp", { title: "Design lead" }), P("dev", "lead"), P("dev2", "lead"), P("solo", null), P("ghost", "missing")];

describe("org utils", () => {
  it("builds roots and children; unknown managers become roots", () => {
    const t = buildTree(people);
    expect(t.roots.map((p) => p.id)).toEqual(["ceo", "ghost", "solo"]);
    expect(t.children.get("lead").map((p) => p.id)).toEqual(["dev", "dev2"]);
  });

  it("treats a reporting loop as roots instead of hiding people", () => {
    const t = buildTree([P("a", "b"), P("b", "a")]);
    expect(t.roots.map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("walks the manager chain nearest first", () => {
    const { byId } = buildTree(people);
    expect(managerChain("dev", byId).map((p) => p.id)).toEqual(["lead", "vp", "ceo"]);
    expect(managerChain("ceo", byId)).toEqual([]);
  });

  it("counts everyone below a person", () => {
    const { children } = buildTree(people);
    expect([...descendantIds("vp", children)].sort()).toEqual(["dev", "dev2", "lead"]);
    expect(teamSize("ceo", children)).toBe(4);
  });

  it("formats local time and ignores bad zones", () => {
    const at = new Date("2026-11-12T04:30:00Z");
    expect(localTime("Asia/Kolkata", at)).toMatch(/10:00/);
    expect(localTime("Not/AZone", at)).toBeNull();
    expect(localTime(null, at)).toBeNull();
  });

  it("search keeps matches and the path above them", () => {
    const { byId } = buildTree(people);
    const r = searchVisible("design", people, byId);
    expect([...r.matches]).toEqual(["lead"]);
    expect([...r.show].sort()).toEqual(["ceo", "lead", "vp"]);
    expect(searchVisible("  ", people, byId)).toBeNull();
  });

  it("sums allocation across projects case-insensitively", () => {
    const m = allocationByEmail([
      { teamDetails: [{ email: "A@x.com", allocationPercent: 60 }, { email: "b@x.com", allocationPercent: null }] },
      { teamDetails: [{ email: "a@x.com", allocationPercent: 50 }] },
    ]);
    expect(m.get("a@x.com")).toBe(110);
    expect(m.has("b@x.com")).toBe(false);
  });

  it("makes initials from names or emails", () => {
    expect(initials("Priya Nair")).toBe("PN");
    expect(initials("", "sam.lee@x.com")).toBe("SL");
    expect(initials("Cher")).toBe("CH");
  });
});
