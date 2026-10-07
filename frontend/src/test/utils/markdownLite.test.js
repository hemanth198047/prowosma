import { describe, it, expect } from "vitest";
import { inlineTokens, parseBlocks, evidenceLines } from "../../utils/markdownLite";

describe("markdownLite", () => {
  it("reads headings, bullets and paragraphs", () => {
    const blocks = parseBlocks("# Title\n\n## Section\n- one\n- two\n\nSome text\nthat wraps.\n\n### Sub\n");
    expect(blocks.map((b) => b.type)).toEqual(["h1", "h2", "ul", "p", "h3"]);
    expect(blocks[2].items).toEqual(["one", "two"]);
    expect(blocks[3].text).toBe("Some text that wraps.");
  });

  it("turns evidence markers into link data, normalising ranges", () => {
    const t = inlineTokens("Budget approved [#3] and **big** _note_ [#9-11] [#12-10]");
    const ev = t.filter((x) => x.t === "ev");
    expect(ev).toEqual([
      { t: "ev", from: 3, to: 3, v: "[#3]" },
      { t: "ev", from: 9, to: 11, v: "[#9-11]" },
      { t: "ev", from: 10, to: 12, v: "[#12-10]" },
    ]);
    expect(t.some((x) => x.t === "bold" && x.v === "big")).toBe(true);
    expect(t.some((x) => x.t === "em" && x.v === "note")).toBe(true);
  });

  it("never produces markup: HTML in the text stays plain text", () => {
    const t = inlineTokens('<img src=x onerror="alert(1)"> and <script>x</script>');
    expect(t.every((x) => x.t === "text")).toBe(true);
    expect(t.map((x) => x.v).join("")).toContain("<script>");
    expect(parseBlocks("<b>hi</b>")[0]).toEqual({ type: "p", text: "<b>hi</b>" });
  });

  it("lists every transcript line a document cites", () => {
    expect(evidenceLines("a [#3] b [#9-11] c [#3]")).toEqual([3, 9, 10, 11]);
    expect(evidenceLines("")).toEqual([]);
    expect(evidenceLines(null)).toEqual([]);
  });

  it("copes with empty and odd input", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks(null)).toEqual([]);
    expect(inlineTokens(undefined)).toEqual([]);
    expect(parseBlocks("a\r\nb")).toEqual([{ type: "p", text: "a b" }]);
  });
});
