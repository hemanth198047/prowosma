import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../styles/classic.css", () => ({}));
import { applyDesign, currentDesign, activeDesign, DESIGNS, DESIGN_CHANGED_EVENT } from "../../utils/design";

describe("Classic / New design switch", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.design;
    window.history.replaceState(null, "", "/");
  });

  it("is New unless someone chose Classic", () => {
    expect(currentDesign()).toBe(DESIGNS.NEW);
  });

  it("remembers the choice and marks the page, telling listeners", async () => {
    const seen = [];
    const on = (e) => seen.push(e.detail);
    window.addEventListener(DESIGN_CHANGED_EVENT, on);
    await applyDesign(DESIGNS.CLASSIC);
    expect(document.documentElement.dataset.design).toBe("classic");
    expect(activeDesign()).toBe("classic");
    expect(currentDesign()).toBe("classic");
    await applyDesign(DESIGNS.NEW);
    expect(document.documentElement.dataset.design).toBe("new");
    expect(seen).toEqual(["classic", "new"]);
    window.removeEventListener(DESIGN_CHANGED_EVENT, on);
  });

  it("?design= switches, is remembered, and leaves the address so a later choice survives a reload", () => {
    window.history.replaceState(null, "", "/tasks?design=classic&view=list");
    expect(currentDesign()).toBe("classic");
    expect(window.location.search).toBe("?view=list");
    expect(currentDesign()).toBe("classic");          // remembered
  });

  it("ignores unknown values", async () => {
    window.history.replaceState(null, "", "/?design=rainbow");
    expect(currentDesign()).toBe("new");
    await applyDesign("rainbow");
    expect(activeDesign()).toBe("new");
  });
});
