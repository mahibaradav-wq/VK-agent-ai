import { describe, expect, it } from "vitest";

import {
  aspectLabel,
  defaultVisualAspect,
  imageSizeForAspect,
  isVisualKindLive,
  parseVisualAspect,
  parseVisualKind,
  prepareVisualPrompt,
  visualAspectsByKind,
} from "@/modules/ai/visual";

describe("visual studio helpers", () => {
  it("defaults stills to 4:5 and video to 9:16", () => {
    expect(defaultVisualAspect()).toBe("4:5");
    expect(defaultVisualAspect("carousel")).toBe("4:5");
    expect(defaultVisualAspect("video")).toBe("9:16");
    expect(imageSizeForAspect("4:5")).toBe("1024x1536");
    expect(imageSizeForAspect("9:16")).toBe("1024x1536");
    expect(imageSizeForAspect("16:9")).toBe("1536x1024");
    expect(aspectLabel("4:5")).toContain("1080×1350");
    expect(visualAspectsByKind.video).toEqual(["9:16", "16:9"]);
  });

  it("builds a brand visual request from the brief without calling a model", () => {
    const prompt = prepareVisualPrompt({
      brief: "Как освободить пространство в вашей квартире?",
      kind: "image",
      aspect: "4:5",
      title: "Полки без хаоса",
    });
    expect(prompt).toContain("User brief: Как освободить пространство в вашей квартире?");
    expect(prompt).toContain("Topic: Полки без хаоса");
    expect(prompt).toContain("1080×1350");
    expect(prompt).toContain("#F3EEE5");
    expect(prompt).toContain("Дом по полочкам");
    expect(prompt).not.toMatch(/watermarks.*required/i);
  });

  it("keeps video as a live cover-still kind with 9:16", () => {
    expect(parseVisualKind("video")).toBe("video");
    expect(isVisualKindLive("video")).toBe(true);
    expect(parseVisualAspect("nope")).toBe("4:5");
    expect(parseVisualAspect("1:1", "video")).toBe("9:16");
    expect(parseVisualAspect("16:9", "video")).toBe("16:9");
  });
});
