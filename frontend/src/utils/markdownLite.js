// A deliberately tiny Markdown reader for the documents Prowosma generates: headings, bullets, paragraphs, **bold**,
// _italic_ and evidence markers like [#12] or [#9-11]. It returns DATA (blocks and tokens) that React renders as plain
// text — nothing is ever turned into HTML, so edited or generated text can't inject markup.

const EVIDENCE = /\[#(\d+)(?:-(\d+))?\]/;
const INLINE = /(\*\*[^*]+\*\*|_[^_]+_|\[#\d+(?:-\d+)?\])/;

/** "Budget [#3] and **more**" → [{t:"text",v:"Budget "},{t:"ev",from:3,to:3,v:"[#3]"},…] */
export function inlineTokens(text) {
  return String(text ?? "").split(INLINE).filter((p) => p !== "").map((part) => {
    const ev = EVIDENCE.exec(part);
    if (ev && ev[0] === part) {
      const from = Number(ev[1]);
      const to = ev[2] ? Number(ev[2]) : from;
      return { t: "ev", from: Math.min(from, to), to: Math.max(from, to), v: part };
    }
    if (/^\*\*[^*]+\*\*$/.test(part)) return { t: "bold", v: part.slice(2, -2) };
    if (/^_[^_]+_$/.test(part)) return { t: "em", v: part.slice(1, -1) };
    return { t: "text", v: part };
  });
}

/** Markdown → [{type:"h1"|"h2"|"h3"|"p"|"ul", text|items}] */
export function parseBlocks(markdown) {
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { blocks.push({ type: "p", text: para.join(" ") }); para = []; } };
  const flushList = () => { if (list) { blocks.push({ type: "ul", items: list }); list = null; } };
  for (const raw of String(markdown ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*-\s+(.*)$/.exec(line);
    if (h) { flushPara(); flushList(); blocks.push({ type: `h${h[1].length}`, text: h[2] }); }
    else if (li) { flushPara(); (list ||= []).push(li[1]); }
    else if (line.trim() === "") { flushPara(); flushList(); }
    else { flushList(); para.push(line.trim()); }
  }
  flushPara(); flushList();
  return blocks;
}

/** All distinct evidence line numbers mentioned in a document. */
export function evidenceLines(markdown) {
  const out = new Set();
  const re = /\[#(\d+)(?:-(\d+))?\]/g;
  let m;
  while ((m = re.exec(String(markdown ?? ""))) !== null) {
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i - Math.min(a, b) < 500; i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}
