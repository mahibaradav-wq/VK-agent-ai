"use client";

import { useActionState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { collectAnalytics, type CollectAnalyticsState } from "@/modules/analytics/actions";
import {
  formatMetricValue,
  metricKeys,
  metricLabels,
  seriesHasMetric,
  type MetricKey,
  type MetricSummary,
  type SeriesPoint,
} from "@/modules/analytics/metrics";

const idle: CollectAnalyticsState = { status: "idle", message: "" };

export type AnalyticsSnapshotView = {
  id: string;
  source: string;
  platform: string;
  collectedAt: string;
  periodStart: string;
  periodEnd: string;
  impressions: number | null;
  reach: number | null;
  followers: number | null;
  engagement: number | null;
  postsPublished: number | null;
  projectName: string | null;
  accountName: string | null;
  rawPayload: unknown;
};

export type AvailabilityRow = {
  key: MetricKey;
  label: string;
  availability: "available" | "unavailable" | "partial";
  details: Array<{ platform: string; available: boolean; reason: string }>;
};

type FilterOption = { id: string; name: string };

function availabilityLabel(value: MetricSummary["availability"]) {
  if (value === "available") {
    return "доступно";
  }
  if (value === "partial") {
    return "частично";
  }
  return "недоступно";
}

function tooltipFormatter(value: unknown) {
  if (typeof value !== "number") {
    return "недоступно";
  }
  return formatMetricValue(value);
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Card className="grid gap-3">
      <div>
        <h2 className="text-lg font-black text-ink">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-ink/60">{hint}</p> : null}
      </div>
      <div className="h-72 w-full">{children}</div>
    </Card>
  );
}

function MetricTile({ label, summary }: { label: string; summary: MetricSummary }) {
  return (
    <Card className="grid gap-1">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{label}</p>
      <p className="text-2xl font-black text-ink">{formatMetricValue(summary.value)}</p>
      <p className="text-xs text-ink/50">
        {availabilityLabel(summary.availability)}
        {summary.missing > 0 ? ` · без метрики: ${summary.missing}` : ""}
      </p>
    </Card>
  );
}

export function AnalyticsDashboard({
  workspaceId,
  canCollect,
  mode,
  demoUsed,
  demoExcluded,
  note,
  from,
  to,
  series,
  totals,
  snapshots,
  availability,
  projects,
  accounts,
  filters,
}: {
  workspaceId: string;
  canCollect: boolean;
  mode: "real" | "demo";
  demoUsed: boolean;
  demoExcluded: number;
  note: string;
  from: string;
  to: string;
  series: SeriesPoint[];
  totals: Record<MetricKey, MetricSummary>;
  snapshots: AnalyticsSnapshotView[];
  availability: AvailabilityRow[];
  projects: FilterOption[];
  accounts: FilterOption[];
  filters: {
    from: string;
    to: string;
    projectId: string;
    socialAccountId: string;
    platform: string;
  };
}) {
  const [state, formAction, pending] = useActionState(collectAnalytics, idle);
  const followersReady = seriesHasMetric(series, "followers");
  const postsReady = seriesHasMetric(series, "postsPublished");
  const impressionsReady = seriesHasMetric(series, "impressions");

  return (
    <div className="grid gap-6">
      {demoUsed ? (
        <StatusBanner tone="warning">
          <p className="font-semibold">Демо-данные</p>
          <p className="mt-1">{note} Они не смешиваются с реальными итогами.</p>
        </StatusBanner>
      ) : (
        <StatusBanner tone="info">
          Режим реальных снимков. {note}
          {demoExcluded > 0 ? ` Исключено демо-снимков: ${demoExcluded}.` : ""}
        </StatusBanner>
      )}

      <Card className="grid gap-4">
        <form className="grid gap-3 md:grid-cols-5" action="/app/analytics" method="get">
          <label className="grid gap-1 text-sm font-medium text-ink">
            С
            <input type="date" name="from" defaultValue={filters.from} className="min-h-10 rounded-2xl border border-ink/10 bg-white px-3" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink">
            По
            <input type="date" name="to" defaultValue={filters.to} className="min-h-10 rounded-2xl border border-ink/10 bg-white px-3" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink">
            Проект
            <select name="projectId" defaultValue={filters.projectId} className="min-h-10 rounded-2xl border border-ink/10 bg-white px-3">
              <option value="">Все проекты</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink">
            Аккаунт
            <select
              name="socialAccountId"
              defaultValue={filters.socialAccountId}
              className="min-h-10 rounded-2xl border border-ink/10 bg-white px-3"
            >
              <option value="">Все аккаунты</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink">
            Платформа
            <select name="platform" defaultValue={filters.platform} className="min-h-10 rounded-2xl border border-ink/10 bg-white px-3">
              <option value="">Все</option>
              <option value="telegram">Telegram</option>
              <option value="vk">ВКонтакте</option>
            </select>
          </label>
          <div className="md:col-span-5">
            <Button type="submit" variant="secondary">
              Фильтровать
            </Button>
          </div>
        </form>
        {canCollect ? (
          <form action={formAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            {filters.socialAccountId ? <input type="hidden" name="socialAccountId" value={filters.socialAccountId} /> : null}
            <Button disabled={pending}>{pending ? "Собираем..." : "Собрать метрики Telegram"}</Button>
            <p className="text-xs text-ink/50">Показы и охват Bot API не отдаёт — в снимок уйдёт пусто, не ноль.</p>
          </form>
        ) : (
          <StatusBanner tone="info">Собирать метрики могут Editor, Admin и Owner.</StatusBanner>
        )}
        {state.message ? (
          <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-5">
        {metricKeys.map((key) => (
          <MetricTile key={key} label={metricLabels[key]} summary={totals[key]} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {followersReady ? (
          <ChartCard title="Подписчики" hint={demoUsed ? "Демо-ряд" : "Последнее значение за день, сумма по аккаунтам"}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3e6d4" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={tooltipFormatter} />
                <Area type="monotone" dataKey="followers" name="Подписчики" stroke="#cc7a2b" fill="#f0c48a" connectNulls={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : (
          <StatusBanner tone="info">Подписчики недоступны для выбранных источников.</StatusBanner>
        )}
        {postsReady ? (
          <ChartCard title="Опубликовано" hint={demoUsed ? "Демо-ряд" : "Успешные PublishAttempt за день"}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3e6d4" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip formatter={tooltipFormatter} />
                <Bar dataKey="postsPublished" name="Опубликовано" fill="#8e4d16" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : (
          <StatusBanner tone="info">Счётчик публикаций недоступен для выбранных источников.</StatusBanner>
        )}
      </div>

      {impressionsReady ? (
        <ChartCard title="Показы и охват" hint={demoUsed ? "Демо-ряд" : "Только если платформа отдала метрику"}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3e6d4" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={tooltipFormatter} />
              <Legend />
              <Bar dataKey="impressions" name="Показы" fill="#cc7a2b" />
              <Bar dataKey="reach" name="Охват" fill="#2d251d" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      ) : (
        <StatusBanner tone="warning">
          Показы и охват недоступны. Для Telegram Bot API этих полей нет — график нулей не рисуется.
        </StatusBanner>
      )}

      <Card className="grid gap-3">
        <h2 className="text-lg font-black text-ink">Доступность метрик</h2>
        <ul className="grid gap-2 text-sm text-ink/80">
          {availability.map((item) => (
            <li key={item.key}>
              <span className="font-semibold text-ink">{item.label}</span>
              {" · "}
              {availabilityLabel(item.availability)}
              {item.details.map((detail) => (
                <span key={detail.platform} className="mt-1 block text-ink/60">
                  {detail.platform}: {detail.available ? "есть" : "нет"} — {detail.reason}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4">
        <h2 className="text-lg font-black text-ink">Снимки · {from} — {to}</h2>
        {snapshots.length === 0 ? <StatusBanner tone="info">Снимков за период нет.</StatusBanner> : null}
        {snapshots.map((item) => (
          <Card key={item.id} className="grid gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
              {item.source === "demo" ? "демо" : item.source} · {item.platform}
              {item.accountName ? ` · ${item.accountName}` : ""}
              {item.projectName ? ` · ${item.projectName}` : ""}
            </p>
            <p className="text-sm text-ink/70">
              collectedAt {item.collectedAt} · период {item.periodStart} — {item.periodEnd}
            </p>
            <p className="text-sm text-ink/80">
              подписчики {formatMetricValue(item.followers)} · показы {formatMetricValue(item.impressions)} · охват{" "}
              {formatMetricValue(item.reach)} · вовлечённость {formatMetricValue(item.engagement)} · опубликовано{" "}
              {formatMetricValue(item.postsPublished)}
            </p>
            <pre className="overflow-x-auto rounded-2xl bg-sand-50 p-3 text-xs text-ink/70">
              {JSON.stringify(item.rawPayload, null, 2)}
            </pre>
          </Card>
        ))}
      </div>
      <p className="sr-only" data-mode={mode}>
        analytics-mode-{mode}
      </p>
    </div>
  );
}
