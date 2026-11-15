import { describe, expect, it } from "vitest";

import { aspectRatioCss, copySystemRules, houseBrand } from "@/modules/brand/visual-standard";

describe("house visual standard", () => {
  it("keeps the documented palette and 4:5 preview box", () => {
    expect(houseBrand.palette.beige).toBe("#F3EEE5");
    expect(houseBrand.palette.olive).toBe("#78866A");
    expect(aspectRatioCss("4:5")).toBe("4 / 5");
    expect(aspectRatioCss("9:16")).toBe("9 / 16");
  });

  it("asks post copy for a practical Russian structure", () => {
    const rules = copySystemRules("post");
    expect(rules).toContain("Дом по полочкам");
    expect(rules).toContain("numbered practical steps");
    expect(rules).toContain("Do not invent sizes");
  });
});
