import { DateTime } from "luxon";

export const analyticsSources = ["telegram", "vk", "demo"] as const;
export type AnalyticsSource = (typeof analyticsSources)[number];

export const metricKeys = ["impressions", "reach", "followers", "engagement", "postsPublished"] as const;
export type MetricKey = (typeof metricKeys)[number];

export const metricLabels: Record<MetricKey, string> = {
  impressions: "Показы",
  reach: "Охват",
  followers: "Подписчики",
  engagement: "Вовлечённость",
  postsPublished: "Опубликовано",
};

export type MetricAvailability = "available" | "unavailable" | "partial";

export type MetricAvailabilityInfo = {
  available: boolean;
  reason: string;
};

export const platformMetricAvailability: Record<string, Record<MetricKey, MetricAvailabilityInfo>> = {
  telegram: {
    followers: { available: true, reason: "Telegram Bot API getChatMemberCount" },
    impressions: { available: false, reason: "Bot API не отдаёт показы публикаций" },
    reach: { available: false, reason: "Bot API не отдаёт охват" },
    engagement: { available: false, reason: "Bot API не отдаёт реакции канала этим методом" },
    postsPublished: { available: true, reason: "успешные PublishAttempt в журнале Polka Social" },
  },
  vk: {
    followers: { available: false, reason: "VK ID не подключён, метрики не собираются" },
    impressions: { available: false, reason: "VK ID не подключён, метрики не собираются" },
    reach: { available: false, reason: "VK ID не подключён, метрики не собираются" },
    engagement: { available: false, reason: "VK ID не подключён, метрики не собираются" },
    postsPublished: { available: false, reason: "VK ID не подключён, метрики не собираются" },
  },
  demo: {
    followers: { available: true, reason: "демонстрационный ряд, не ответ платформы" },
    impressions: { available: true, reason: "демонстрационный ряд, не ответ платформы" },
    reach: { available: true, reason: "демонстрационный ряд, не ответ платформы" },
    engagement: { available: true, reason: "демонстрационный ряд, не ответ платформы" },
    postsPublished: { available: true, reason: "демонстрационный ряд, не ответ платформы" },
  },
};

export const DEMO_SOURCE = "demo" as const;
export const DEMO_NOTE = "Демонстрационные данные. Это не метрики платформы.";

export type NormalizedSnapshot = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  socialAccountId: string | null;
  platform: string;
  source: string;
  collectedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  impressions: number | null;
  reach: number | null;
  followers: number | null;
  engagement: number | null;
  postsPublished: number | null;
  rawPayload: unknown;
};

export type MetricSummary = {
  value: number | null;
  availability: MetricAvailability;
  contributing: number;
  missing: number;
};

export type SeriesPoint = {
  date: string;
  impressions: number | null;
  reach: number | null;
  followers: number | null;
  engagement: number | null;
  postsPublished: number | null;
};

export type DashboardTotals = Record<MetricKey, MetricSummary>;

export type AggregatedDashboard = {
  mode: "real" | "demo";
  demoUsed: boolean;
  demoExcluded: number;
  snapshots: NormalizedSnapshot[];
  series: SeriesPoint[];
  totals: DashboardTotals;
};

export function isDemoSource(source: string) {
  return source === DEMO_SOURCE;
}

export function formatMetricValue(value: number | null) {
  if (value === null) {
    return "недоступно";
  }
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function utcDayBounds(at: Date) {
  const start = DateTime.fromJSDate(at, { zone: "utc" }).startOf("day");
  return {
    periodStart: start.toJSDate(),
    periodEnd: start.endOf("day").toJSDate(),
  };
}

export function defaultRange(at: Date) {
  const end = DateTime.fromJSDate(at, { zone: "utc" }).startOf("day");
  const start = end.minus({ days: 13 });
  return {
    from: start.toJSDate(),
    to: end.endOf("day").toJSDate(),
  };
}

export function parseIsoDay(value: string | undefined, fallback: Date) {
  if (!value) {
    return fallback;
  }
  const parsed = DateTime.fromISO(value, { zone: "utc" });
  return parsed.isValid ? parsed.startOf("day").toJSDate() : fallback;
}

function summarize(values: Array<number | null>): MetricSummary {
  const present = values.filter((value): value is number => value !== null);
  const missing = values.length - present.length;
  if (present.length === 0) {
    return { value: null, availability: "unavailable", contributing: 0, missing };
  }
  return {
    value: present.reduce((sum, value) => sum + value, 0),
    availability: missing > 0 ? "partial" : "available",
    contributing: present.length,
    missing,
  };
}

function snapshotKey(snapshot: NormalizedSnapshot) {
  const account = snapshot.socialAccountId ?? "none";
  return `${account}|${snapshot.source}|${snapshot.periodStart.toISOString()}`;
}

export function dedupeLatest(snapshots: NormalizedSnapshot[]) {
  const latest = new Map<string, NormalizedSnapshot>();
  for (const snapshot of snapshots) {
    const key = snapshotKey(snapshot);
    const current = latest.get(key);
    if (!current || snapshot.collectedAt > current.collectedAt) {
      latest.set(key, snapshot);
    }
  }
  return [...latest.values()].sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
}

export function buildSeries(snapshots: NormalizedSnapshot[]): SeriesPoint[] {
  const byDate = new Map<string, NormalizedSnapshot[]>();
  for (const snapshot of snapshots) {
    const date = DateTime.fromJSDate(snapshot.periodStart, { zone: "utc" }).toISODate() ?? "";
    const bucket = byDate.get(date) ?? [];
    bucket.push(snapshot);
    byDate.set(date, bucket);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({
      date,
      impressions: summarize(rows.map((row) => row.impressions)).value,
      reach: summarize(rows.map((row) => row.reach)).value,
      followers: summarize(rows.map((row) => row.followers)).value,
      engagement: summarize(rows.map((row) => row.engagement)).value,
      postsPublished: summarize(rows.map((row) => row.postsPublished)).value,
    }));
}

export function buildTotals(snapshots: NormalizedSnapshot[]): DashboardTotals {
  const latestFollowers = new Map<string, NormalizedSnapshot>();
  for (const snapshot of snapshots) {
    const key = snapshot.socialAccountId ?? snapshot.id;
    const current = latestFollowers.get(key);
    if (!current || snapshot.collectedAt > current.collectedAt) {
      latestFollowers.set(key, snapshot);
    }
  }
  const followerRows = [...latestFollowers.values()];
  return {
    impressions: summarize(snapshots.map((row) => row.impressions)),
    reach: summarize(snapshots.map((row) => row.reach)),
    followers: summarize(followerRows.map((row) => row.followers)),
    engagement: summarize(snapshots.map((row) => row.engagement)),
    postsPublished: summarize(snapshots.map((row) => row.postsPublished)),
  };
}

export function aggregateSnapshots(snapshots: NormalizedSnapshot[]): AggregatedDashboard {
  const real = snapshots.filter((row) => !isDemoSource(row.source));
  const demo = snapshots.filter((row) => isDemoSource(row.source));
  const useDemo = real.length === 0;
  const selected = dedupeLatest(useDemo ? demo : real);
  return {
    mode: useDemo ? "demo" : "real",
    demoUsed: useDemo,
    demoExcluded: useDemo ? 0 : demo.length,
    snapshots: selected,
    series: buildSeries(selected),
    totals: buildTotals(selected),
  };
}

export function buildDemoSeries(from: Date, to: Date, workspaceId = "demo"): NormalizedSnapshot[] {
  const start = DateTime.fromJSDate(from, { zone: "utc" }).startOf("day");
  const end = DateTime.fromJSDate(to, { zone: "utc" }).startOf("day");
  const snapshots: NormalizedSnapshot[] = [];
  let cursor = start;
  let index = 0;
  while (cursor <= end) {
    const periodStart = cursor.toJSDate();
    const periodEnd = cursor.endOf("day").toJSDate();
    snapshots.push({
      id: `demo-${cursor.toISODate()}`,
      workspaceId,
      projectId: null,
      socialAccountId: null,
      platform: DEMO_SOURCE,
      source: DEMO_SOURCE,
      collectedAt: periodEnd,
      periodStart,
      periodEnd,
      impressions: 80 + index * 6,
      reach: 55 + index * 4,
      followers: 1200 + index * 9,
      engagement: 8 + (index % 5),
      postsPublished: index % 3 === 0 ? 1 : 0,
      rawPayload: { demo: true, note: DEMO_NOTE },
    });
    cursor = cursor.plus({ days: 1 });
    index += 1;
  }
  return snapshots;
}

export function seriesHasMetric(series: SeriesPoint[], key: MetricKey) {
  return series.some((point) => point[key] !== null);
}

function platformInfo(platform: string, key: MetricKey): MetricAvailabilityInfo {
  return platformMetricAvailability[platform]?.[key] ?? { available: false, reason: "неизвестная платформа" };
}

export function availabilityForPlatforms(platforms: string[]) {
  const unique = [...new Set(platforms.length > 0 ? platforms : ["telegram", "vk"])];
  return metricKeys.map((key) => {
    const details = unique.map((platform) => ({ platform, ...platformInfo(platform, key) }));
    const availableCount = details.filter((item) => item.available).length;
    const availability: MetricAvailability =
      availableCount === 0 ? "unavailable" : availableCount === details.length ? "available" : "partial";
    return { key, label: metricLabels[key], availability, details };
  });
}
