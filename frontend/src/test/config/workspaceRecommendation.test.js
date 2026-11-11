import { describe, it, expect } from "vitest";
import {
  TEMPLATES, INDUSTRIES, ROLES, recommendTemplate, suggestedDescription, templateById,
} from "../../config/workspaceRecommendation";

describe("recommendTemplate", () => {
  it("always returns a real template for every field + role combination", () => {
    for (const i of INDUSTRIES) {
      for (const r of ROLES) {
        const { template, reason } = recommendTemplate(i.key, r.key);
        expect(TEMPLATES).toContain(template);
        expect(template.id).not.toBe("blank");
        expect(reason).toBeTruthy();
      }
    }
  });

  it("every option points at a template that exists", () => {
    for (const o of [...INDUSTRIES, ...ROLES]) {
      if (o.template) expect(templateById(o.template), o.key).not.toBeNull();
    }
  });

  it("uses the field's template for hands-on roles", () => {
    expect(recommendTemplate("software", "team-member").template.id).toBe("software-delivery");
    expect(recommendTemplate("media", "project-manager").template.id).toBe("agile-product");
    expect(recommendTemplate("finance", "team-lead").template.id).toBe("pmo");
    expect(recommendTemplate("education", "team-member").template.id).toBe("knowledge-hub");
    expect(recommendTemplate("manufacturing", "project-manager").template.id).toBe("enterprise-transformation");
  });

  it("gives leadership and PMO roles the portfolio setup in any field", () => {
    expect(recommendTemplate("media", "executive").template.id).toBe("pmo");
    expect(recommendTemplate("software", "pmo").template.id).toBe("pmo");
  });

  it("gives product managers the product setup", () => {
    expect(recommendTemplate("software", "product-manager").template.id).toBe("agile-product");
  });

  it("falls back safely on unknown answers", () => {
    expect(recommendTemplate("nope", "nope").template.id).toBe("agile-product");
    expect(recommendTemplate(undefined, undefined).template).toBeTruthy();
  });

  it("explains the choice in plain words", () => {
    expect(recommendTemplate("media", "team-member").reason).toMatch(/Media & Entertainment/);
    expect(recommendTemplate("media", "executive").reason).toMatch(/^As an Executive/);
  });
});

describe("suggestedDescription", () => {
  it("names the field, and stays empty for 'Something else'", () => {
    expect(suggestedDescription("finance")).toBe("Finance & Banking workspace");
    expect(suggestedDescription("other")).toBe("");
    expect(suggestedDescription("")).toBe("");
  });
});
