/* global process */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findPlaceholders, ALLOWED_PLACEHOLDERS } from "../../../scripts/check-legal-placeholders.mjs";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");          // vitest runs from the frontend folder
const privacy = read("public/privacy.html");
const terms = read("public/terms.html");
const vercel = JSON.parse(read("vercel.json"));

describe("Privacy Policy page — what Google's verification requires", () => {
  it("states the Limited Use commitment and links Google's policy", () => {
    expect(privacy).toContain("Google API Services User Data Policy");
    expect(privacy).toContain("Limited Use requirements");
    expect(privacy).toContain("https://developers.google.com/terms/api-services-user-data-policy");
  });

  it("names every Google scope requested and explains why", () => {
    expect(privacy).toContain("https://www.googleapis.com/auth/meetings.space.readonly");
    expect(privacy).toContain("openid");
    expect(privacy).toMatch(/read-only/i);
    expect(privacy).toMatch(/Why we need it/);
  });

  it("describes what is accessed, stored, shared, retained and how to delete or revoke", () => {
    for (const phrase of ["What we access and store", "How we use it", "Who it is shared with", "How long we keep information", "Revoking access and deleting Google data",
      "myaccount.google.com/permissions", "Disconnect my Google account", "Delete transcript", "AES-256-GCM"]) expect(privacy, phrase).toContain(phrase);
  });

  it("makes the commitments Google looks for: no ads, no selling, no AI-model training, no routine human reading", () => {
    expect(privacy).toMatch(/do <strong>not<\/strong> use Google user data for advertising/);
    expect(privacy).toMatch(/do <strong>not<\/strong> use Google user data to develop, improve or train generalized/);
    expect(privacy).toMatch(/do not sell personal information/i);
    expect(privacy).toMatch(/staff do not read your Google user data unless/);
  });

  it("is honest about the AI provider and about optional recording: what, where it goes, how long it is kept", () => {
    expect(privacy).toMatch(/AI provider selected by your workspace administrator/);
    expect(privacy).not.toMatch(/do <strong>not<\/strong> record audio or video/);                          // no longer true, so it must not be there
    expect(privacy).toMatch(/optional <strong>recording<\/strong> feature/);
    expect(privacy).toContain('id="recordings"');
    expect(privacy).toMatch(/audio is deleted automatically 24 hours after the recording ends/);
    expect(privacy).toMatch(/Meeting audio \(only if recording is used\)/);
    expect(privacy).toMatch(/Speech-to-text \(only if recording is used\)/);
    expect(privacy).toMatch(/encrypted at rest with AES-256-GCM/);
    expect(privacy).toMatch(/everyone in the meeting knows it is being recorded/);
    expect(privacy).not.toMatch(/We never join your meetings/);                                    // a Fireflies notetaker can now join at a person's request
    expect(privacy).toContain('id="fireflies"');
    expect(privacy).toMatch(/Prowosma itself never joins your meetings/);
    expect(privacy).toMatch(/We do not ask Fireflies for the audio or video/);
    expect(privacy).toMatch(/Meeting notetaker \(only if the Fireflies integration is used\)/);
  });

  it("has a contact route and covers user rights", () => {
    expect(privacy).toContain('mailto:{{CONTACT_EMAIL}}');
    expect(privacy).toMatch(/Your choices and rights/);
  });
});

describe("Terms of Service page", () => {
  it("covers the essentials, including meeting-consent responsibility and AI output", () => {
    for (const phrase of ["Acceptable use", "Your content and meeting transcripts", "Consent and notice", "AI-generated content", "Limitation of liability", "Governing law", "Suspension and termination"])
      expect(terms, phrase).toContain(phrase);
    expect(terms).toContain('href="/privacy"');
    expect(terms).toContain("Recordings.");
    expect(terms).toContain("Notetakers.");
    expect(terms).toMatch(/if enabled, Fireflies\.ai/);
    expect(terms).not.toMatch(/does not join, record or capture audio/);
  });
});

describe("Both pages are safe to publish publicly", () => {
  for (const [name, html] of [["privacy", privacy], ["terms", terms]]) {
    it(`${name}: is a complete, self-contained, script-free page`, () => {
      expect(html).toMatch(/^<!DOCTYPE html>/);
      expect(html).toContain('<meta name="viewport"');
      expect(html).toMatch(/<title>.+<\/title>/);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<(link|img|iframe)[^>]+(src|href)="https?:/i);                 // nothing loaded from another site
      expect(html).not.toMatch(/localhost|127\.0\.0\.1/);
    });

    it(`${name}: links to the other page and back to the app`, () => {
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/terms"');
      expect(html).toContain('href="/"');
    });

    it(`${name}: contains only the four known placeholders (nothing else is left half-written)`, () => {
      for (const p of Object.keys(findPlaceholders(html))) expect(ALLOWED_PLACEHOLDERS).toContain(p);
      expect(html).not.toMatch(/TODO|FIXME|lorem ipsum/i);
    });
  }
});

describe("Hosting configuration", () => {
  it("serves /privacy and /terms as static pages, ahead of the catch-all that would show the app", () => {
    const idx = (src) => vercel.rewrites.findIndex((r) => r.source === src);
    expect(vercel.rewrites[idx("/privacy")].destination).toBe("/privacy.html");
    expect(vercel.rewrites[idx("/terms")].destination).toBe("/terms.html");
    expect(idx("/privacy")).toBeLessThan(idx("/(.*)"));
    expect(idx("/terms")).toBeLessThan(idx("/(.*)"));
    expect(vercel.rewrites[vercel.rewrites.length - 1].source).toBe("/(.*)");              // the SPA fallback still exists, last
  });
});

describe("the placeholder checker", () => {
  it("counts placeholders and reports none for filled text", () => {
    expect(findPlaceholders("a {{COMPANY_NAME}} b {{COMPANY_NAME}} {{CONTACT_EMAIL}}")).toEqual({ "{{COMPANY_NAME}}": 2, "{{CONTACT_EMAIL}}": 1 });
    expect(findPlaceholders("Acme Ltd, hello@acme.com")).toEqual({});
  });
});
