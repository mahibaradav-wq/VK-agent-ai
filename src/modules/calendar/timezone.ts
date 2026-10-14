import { DateTime } from "luxon";

import { AccessError } from "@/modules/access/permissions";

export const defaultTimezone = "Europe/Moscow";

export const displayTimezones = [
  { id: "UTC", label: "UTC" },
  { id: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { id: "Europe/Moscow", label: "Москва (UTC+3)" },
  { id: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { id: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)" },
  { id: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { id: "America/New_York", label: "Нью-Йорк" },
] as const;

export type DisplayTimezone = (typeof displayTimezones)[number]["id"];

export const TIMEZONE_COOKIE = "polka-timezone";

export function parseTimezone(value: string | undefined | null): DisplayTimezone {
  const allowed = new Set<string>(displayTimezones.map((item) => item.id));
  if (value && allowed.has(value)) {
    return value as DisplayTimezone;
  }
  return defaultTimezone;
}

export function localDateTimeToUtc(localDateTime: string, timezone: string) {
  const zone = parseTimezone(timezone);
  const parsed = DateTime.fromISO(localDateTime, { zone, setZone: true });

  if (!parsed.isValid) {
    if (parsed.invalidReason === "unsupported zone") {
      throw new AccessError(400, "Неизвестный часовой пояс.");
    }
    throw new AccessError(400, "Это локальное время не существует из-за перехода на летнее/зимнее время.");
  }

  return parsed.toUTC().toJSDate();
}

export function utcToLocalInput(utcDate: Date, timezone: string) {
  return DateTime.fromJSDate(utcDate, { zone: "utc" }).setZone(parseTimezone(timezone)).toFormat("yyyy-LL-dd'T'HH:mm");
}

export function utcToDisplay(utcDate: Date, timezone: string) {
  return DateTime.fromJSDate(utcDate, { zone: "utc" })
    .setZone(parseTimezone(timezone))
    .setLocale("ru")
    .toFormat("d MMM yyyy, HH:mm");
}

export function parseAnchorDate(value: string | undefined, timezone: string) {
  const zone = parseTimezone(timezone);
  const parsed = value ? DateTime.fromISO(value, { zone }) : DateTime.now().setZone(zone);
  return (parsed.isValid ? parsed : DateTime.now().setZone(zone)).startOf("day");
}

export function startOfWeek(date: DateTime) {
  return date.startOf("day").minus({ days: date.weekday - 1 });
}

export function calendarRange(view: "month" | "week" | "day" | "list", anchor: DateTime) {
  if (view === "day") {
    const start = anchor.startOf("day");
    return { start, end: start.plus({ days: 1 }) };
  }

  if (view === "week" || view === "list") {
    const start = startOfWeek(anchor);
    return { start, end: start.plus({ days: 7 }) };
  }

  const monthStart = anchor.startOf("month");
  const start = startOfWeek(monthStart);
  const monthEnd = anchor.endOf("month");
  const end = startOfWeek(monthEnd).plus({ days: 7 });
  return { start, end };
}

export function toUtcRange(view: "month" | "week" | "day" | "list", anchor: DateTime) {
  const { start, end } = calendarRange(view, anchor);
  return { from: start.toUTC().toJSDate(), to: end.toUTC().toJSDate(), start, end };
}

export const calendarViews = ["month", "week", "day", "list"] as const;
export type CalendarView = (typeof calendarViews)[number];

export function parseCalendarView(value: string | undefined): CalendarView {
  return calendarViews.includes(value as CalendarView) ? (value as CalendarView) : "month";
}
