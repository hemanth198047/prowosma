#!/usr/bin/env node
/**
 * Builds src/styles/classic.css: the app's previous ("Classic") look, so people can switch between the
 * Classic and New designs at runtime (user menu → Design, or ?design=classic).
 *
 * It takes every stylesheet of the frontend at a git ref (default: the tag `design-classic`, which points
 * at the last commit with the previous design), keeps the app's import order, and scopes every rule under
 * html[data-design="classic"]. Scoped rules beat the current ones only while that attribute is set, so the
 * New design is untouched. @keyframes are renamed (classic-*) so they never replace the current ones.
 *
 *   node scripts/build-classic-css.mjs            # from the design-classic tag
 *   node scripts/build-classic-css.mjs <git-ref>  # from another ref
 *
 * Screens and components added after that ref have no Classic styles of their own, and Classic's scoped
 * reset (`* { padding: 0 }`) and element rules (button, input…) would outrank their unscoped class rules and
 * collapse them. So the current stylesheets' rules that name a class unknown to the Classic CSS are
 * appended, scoped the same way: new components keep their layout in Classic, old screens keep the Classic look.
 *
 * The output is generated: don't edit it by hand. Re-run this when the Classic design itself must change.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const here = dirname(fileURLToPath(import.meta.url));
const ref = process.argv[2] || "design-classic";
const SCOPE = 'html[data-design="classic"]';
const git = (...args) => execFileSync("git", args, { cwd: join(here, ".."), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const all = git("ls-tree", "-r", "--name-only", ref, "--", "src").split("\n").filter((f) => f.endsWith(".css"));
const read = (path) => git("show", `${ref}:frontend/${path}`);

// Import order: index.css, then App.css (each @import followed in place), then every other stylesheet
// (page sheets imported by components), alphabetically.
const fontImports = new Set();
function inImportOrder(files, readFile) {
  const ordered = [];
  const seen = new Set();
  function visit(path) {
    if (seen.has(path) || !files.includes(path)) return;
    seen.add(path);
    const text = readFile(path);
    for (const m of text.matchAll(/@import\s+(?:url\()?["']([^"')]+)["']\)?[^;]*;/g)) {
      const target = m[1];
      if (/^https?:/.test(target)) { fontImports.add(m[0]); continue; }
      visit(posix.normalize(posix.join(posix.dirname(path), target)));
    }
    ordered.push({ path, text });
  }
  visit("src/index.css");
  visit("src/App.css");
  for (const f of [...files].sort()) visit(f);
  return ordered;
}
const ordered = inImportOrder(all, read);
const classicFonts = [...fontImports];

const ROOTISH = /^(:root|html)((?:\[[^\]]+\])*)/;
function scopeSelector(sel) {
  const s = sel.trim();
  if (!s) return s;
  const root = s.match(ROOTISH);
  if (root) return SCOPE + root[2] + s.slice(root[0].length);
  const theme = s.match(/^((?:\[data-theme=[^\]]+\])+)/);
  if (theme) return SCOPE + theme[1] + s.slice(theme[0].length);
  return `${SCOPE} ${s}`;
}

const keyframes = new Set();
const plugin = {
  postcssPlugin: "scope-classic",
  Once(root) {
    root.walkAtRules("import", (a) => a.remove());
    root.walkAtRules(/keyframes$/, (a) => { keyframes.add(a.params.trim()); a.params = `classic-${a.params.trim()}`; });
    root.walkRules((rule) => {
      const parent = rule.parent;
      if (parent && parent.type === "atrule" && /keyframes$/.test(parent.name)) return;
      rule.selectors = rule.selectors.map(scopeSelector);
    });
  },
};

const pieces = [];
for (const { path, text } of ordered) {
  const out = postcss([plugin]).process(text, { from: path }).root;
  pieces.push({ path, root: out });
}
// Classes the Classic CSS knows (before scoping).
const CLASS = /\.(-?[_a-zA-Z][\w-]*)/g;
const classesOf = (sel) => [...sel.matchAll(CLASS)].map((m) => m[1]);
const classicClasses = new Set();
for (const { text } of ordered) {
  postcss.parse(text).walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
    for (const sel of rule.selectors) for (const c of classesOf(sel)) classicClasses.add(c);
  });
}
const isNewOnly = (sel) => classesOf(sel).some((c) => !classicClasses.has(c));

// Current stylesheets: keep only rules naming a class Classic never styled (newer markup).
const frontend = join(here, "..");
const current = git("ls-files", "src").split("\n").filter((f) => f.endsWith(".css") && f !== "src/styles/classic.css");
let added = 0;
const currentPieces = [];
for (const { path, text } of inImportOrder(current, (p) => readFileSync(join(frontend, p), "utf8"))) {
  const root = postcss.parse(text, { from: path });
  root.walkAtRules("import", (a) => a.remove());
  root.walkAtRules(/keyframes$/, (a) => a.remove());          // the New sheets (always loaded) define them
  root.walkRules((rule) => {
    const keep = rule.selectors.filter(isNewOnly);
    if (!keep.length) { rule.remove(); return; }
    rule.selectors = keep.map(scopeSelector);
    added += 1;
  });
  root.walkAtRules((a) => { if (a.nodes && !a.nodes.length) a.remove(); });
  root.walkAtRules((a) => { if (a.nodes && !a.nodes.length) a.remove(); });
  root.walkComments((c) => c.remove());
  if (root.nodes.length) currentPieces.push({ path, root });
}

// Point animations at the renamed keyframes.
const names = [...keyframes].sort((a, b) => b.length - a.length);
const renameAnimations = (value) => {
  let v = value;
  for (const n of names) v = v.replace(new RegExp(`(^|[\\s,])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,])`, "g"), `$1classic-${n}`);
  return v;
};
let css = "";
for (const { path, root } of pieces) {
  root.walkDecls(/^(animation|animation-name)$/, (d) => { d.value = renameAnimations(d.value); });
  css += `\n/* ── ${path} ── */\n${root.toString()}\n`;
}
css += "\n/* ════ Components added after the Classic design (current rules naming classes Classic never styled) ════ */\n";
for (const { path, root } of currentPieces) css += `\n/* ── current ${path} ── */\n${root.toString()}\n`;

const header = `/* GENERATED by scripts/build-classic-css.mjs from ${ref} (${git("rev-parse", "--short", `${ref}^{commit}`).trim()}). Do not edit by hand.
   The Classic design: every rule is scoped under ${SCOPE}; loaded only when someone picks Classic. */\n`;
writeFileSync(join(here, "..", "src", "styles", "classic.css"), header + classicFonts.join("\n") + "\n" + css);
console.log(`classic.css: ${ordered.length} stylesheets, ${keyframes.size} keyframes renamed, ${added} current rules for new components, ${(css.length / 1024).toFixed(0)} KB`);
