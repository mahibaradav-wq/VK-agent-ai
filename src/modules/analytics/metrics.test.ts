import { describe, expect, it } from "vitest";

import {
  aggregateSnapshots,
  buildDemoSeries,
  DEMO_NOTE,
  formatMetricValue,
  platformMetricAvailability,
  type NormalizedSnapshot,
} from "@/modules/analytics/metrics";

function snapshot(partial: Partial<NormalizedSnapshot> & Pick<NormalizedSnapshot, "id" | "source">): NormalizedSnapshot {
  const day = partial.periodStart ?? new Date("2026-10-10T00:00:00.000Z");
  return {
    workspaceId: "ws-1",
    projectId: null,
    socialAccountId: partial.socialAccountId ?? "acc-1",
    platform: partial.source,
    collectedAt: partial.collectedAt ?? new Date("2026-10-10T12:00:00.000Z"),
    periodStart: day,
    periodEnd: new Date("2026-10-10T23:59:59.999Z"),
    impressions: null,
    reach: null,
    followers: null,
    engagement: null,
    postsPublished: null,
    rawPayload: {},
    ...partial,
  };
}

describe("analytics aggregation", () => {
  it("does not treat unavailable metrics as zero", () => {
    const result = aggregateSnapshots([
      snapshot({
        id: "a",
        source: "telegram",
        impressions: 10,
        followers: 100,
        postsPublished: 1,
      }),
      snapshot({
        id: "b",
        source: "telegram",
        socialAccountId: "acc-2",
        impressions: null,
        followers: 50,
        postsPublished: 0,
      }),
    ]);
    expect(result.mode).toBe("real");
    expect(result.demoUsed).toBe(false);
    expect(result.totals.impressions).toMatchObject({ value: 10, availability: "partial", missing: 1 });
    expect(result.totals.reach.value).toBeNull();
    expect(result.totals.reach.availability).toBe("unavailable");
    expect(result.totals.followers.value).toBe(150);
    expect(result.totals.postsPublished.value).toBe(1);
    expect(formatMetricValue(null)).toBe("недоступно");
    expect(formatMetricValue(0)).toBe("0");
  });

  it("keeps the latest snapshot per account and day", () => {
    const result = aggregateSnapshots([
      snapshot({
        id: "old",
        source: "telegram",
        collectedAt: new Date("2026-10-10T08:00:00.000Z"),
        followers: 10,
        postsPublished: 1,
      }),
      snapshot({
        id: "new",
        source: "telegram",
        collectedAt: new Date("2026-10-10T18:00:00.000Z"),
        followers: 12,
        postsPublished: 2,
      }),
    ]);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]?.id).toBe("new");
    expect(result.totals.followers.value).toBe(12);
    expect(result.totals.postsPublished.value).toBe(2);
  });

  it("does not mix demo snapshots into real totals", () => {
    const result = aggregateSnapshots([
      snapshot({ id: "real", source: "telegram", followers: 5, impressions: null }),
      snapshot({ id: "demo", source: "demo", platform: "demo", followers: 9999, impressions: 4000 }),
    ]);
    expect(result.mode).toBe("real");
    expect(result.demoExcluded).toBe(1);
    expect(result.totals.followers.value).toBe(5);
    expect(result.totals.impressions.value).toBeNull();
    expect(result.snapshots.map((item) => item.id)).toEqual(["real"]);
  });

  it("uses labeled demo series only when real data is absent", () => {
    const generated = buildDemoSeries(new Date("2026-10-01T00:00:00.000Z"), new Date("2026-10-03T00:00:00.000Z"));
    expect(generated.every((item) => item.source === "demo")).toBe(true);
    expect(JSON.stringify(generated[0]?.rawPayload)).toContain(DEMO_NOTE);
    const result = aggregateSnapshots(generated);
    expect(result.mode).toBe("demo");
    expect(result.demoUsed).toBe(true);
    expect(result.series.length).toBe(3);
    expect(result.totals.followers.value).toBeGreaterThan(0);
  });

  it("marks Telegram impressions as unavailable and followers as available", () => {
    expect(platformMetricAvailability.telegram.impressions.available).toBe(false);
    expect(platformMetricAvailability.telegram.reach.available).toBe(false);
    expect(platformMetricAvailability.telegram.followers.available).toBe(true);
    expect(platformMetricAvailability.vk.followers.available).toBe(false);
  });
});
