/* global process, console */
// Run before going live (and before submitting the Google verification):   npm run check:legal
// The Privacy Policy and Terms of Service pages contain four {{PLACEHOLDERS}} that only you can fill in. Google's reviewers reject pages
// that still contain them. This lists every one that is left and exits with an error until they are all replaced.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export const ALLOWED_PLACEHOLDERS = ["{{COMPANY_NAME}}", "{{CONTACT_EMAIL}}", "{{EFFECTIVE_DATE}}", "{{GOVERNING_LAW}}"];
export const LEGAL_FILES = ["public/privacy.html", "public/terms.html"];

/** @returns {Record<string, number>} placeholder -> how many times it appears */
export function findPlaceholders(html) {
  const found = {};
  for (const m of html.matchAll(/\{\{[A-Z_]+\}\}/g)) found[m[0]] = (found[m[0]] || 0) + 1;
  return found;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let left = 0;
  for (const rel of LEGAL_FILES) {
    const found = findPlaceholders(readFileSync(path.join(root, rel), "utf8"));
    for (const [name, count] of Object.entries(found)) {
      left += count;
      console.error(`  ${rel}: ${name} ×${count}`);
    }
  }
  if (left > 0) {
    console.error(`\n${left} placeholder(s) still to fill in. Replace them (find & replace) in public/privacy.html and public/terms.html:`);
    console.error("  {{COMPANY_NAME}}   your legal or trading name        {{CONTACT_EMAIL}}  a monitored address people can write to");
    console.error("  {{EFFECTIVE_DATE}} e.g. 8 October 2026               {{GOVERNING_LAW}}  e.g. India (Karnataka) / the State of Delaware, USA");
    process.exit(1);
  }
  console.log("✓ No placeholders left in the Privacy Policy and Terms of Service.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
