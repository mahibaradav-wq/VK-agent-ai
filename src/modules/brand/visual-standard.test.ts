import { describe, expect, it } from "vitest";

import {
  aspectRatioCss,
  bodyMeetsCopyLength,
  copyLengthSpec,
  copyMaxTokens,
  copySystemRules,
  houseBrand,
} from "@/modules/brand/visual-standard";

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
    expect(copySystemRules("post", "short")).toMatch(/900–1400/);
    expect(copySystemRules("post", "medium")).toMatch(/1900–2600/);
    expect(copySystemRules("post", "long")).toMatch(/3800–5000/);
    expect(copySystemRules("post", "long")).not.toMatch(/900–1400/);
    expect(copyMaxTokens("short")).toBe(copyLengthSpec.short.maxTokens);
    expect(copyMaxTokens("long")).toBe(copyLengthSpec.long.maxTokens);
    expect(bodyMeetsCopyLength("а".repeat(1332), "long")).toBe(false);
    expect(bodyMeetsCopyLength("а".repeat(3800), "long")).toBe(true);
    expect(bodyMeetsCopyLength("а".repeat(900), "short")).toBe(true);
  });
});
