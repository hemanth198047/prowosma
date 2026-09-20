import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guard: show API errors to people via apiErrorMessage(err, fallback), never by
 * reading `response.data.error` directly.
 *
 * The backend answers failures in two shapes — { error: CODE, message: text }
 * (exception handler and the role/plan/workspace filters) and { error: text }
 * (inline controller replies) — so reading `.error` first shows raw codes like
 * "FORBIDDEN" or "UPGRADE_REQUIRED" to someone who was just told they can't do
 * something, while reading only `.message` hides the real reason of the inline
 * replies. apiErrorMessage handles both.
 *
 * Comparing against a code (`.data.error === "PASSWORD_EXPIRED"`) is logic, not
 * display, and is allowed.
 */
// Vitest runs from the project root (npm test), so src/ is anchored on cwd.
const SRC = path.resolve(process.cwd(), "src");
const SKIP_DIRS = new Set(["test", "node_modules"]);
const ALLOWED_FILES = new Set([path.join("utils", "apiError.js")]);
const RAW_READ = /\.data\??\.error\b(?!\s*===)/;

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(path.join(dir, entry.name));
    } else if (/\.(jsx?|mjs)$/.test(entry.name)) {
      yield path.join(dir, entry.name);
    }
  }
}

describe("error messages shown to people", () => {
  it("never read response.data.error directly (use apiErrorMessage)", () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(SRC, file);
      if (ALLOWED_FILES.has(rel)) continue;
      fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return; // comments
        if (RAW_READ.test(line)) offenders.push(`${rel}:${i + 1}  ${t.slice(0, 110)}`);
      });
    }
    expect(
      offenders,
      "Use apiErrorMessage(err, fallback) from utils/apiError instead of reading data.error:\n  " + offenders.join("\n  ")
    ).toEqual([]);
  });
});
