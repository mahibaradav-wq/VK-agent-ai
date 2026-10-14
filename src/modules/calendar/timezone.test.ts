import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import {
  calendarRange,
  localDateTimeToUtc,
  parseTimezone,
  startOfWeek,
  utcToDisplay,
  utcToLocalInput,
} from "@/modules/calendar/timezone";

describe("calendar timezones", () => {
  it("stores Moscow wall time as UTC+3", () => {
    const utc = localDateTimeToUtc("2026-10-14T15:00", "Europe/Moscow");
    expect(utc.toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(utcToLocalInput(utc, "Europe/Moscow")).toBe("2026-10-14T15:00");
    expect(utcToDisplay(utc, "Europe/Moscow")).toContain("15:00");
  });

  it("rejects a non-existent DST spring-forward time", () => {
    expect(() => localDateTimeToUtc("2026-03-08T02:30", "America/New_York")).toThrow(AccessError);
    expect(() => localDateTimeToUtc("2026-03-08T02:30", "America/New_York")).toThrow(/летнее/);
  });

  it("picks the first offset for an ambiguous fall-back time", () => {
    const utc = localDateTimeToUtc("2026-11-01T01:30", "America/New_York");
    expect(utc.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("builds a Monday-based month grid", () => {
    const anchor = DateTime.fromISO("2026-10-14", { zone: "Europe/Moscow" });
    const { start, end } = calendarRange("month", anchor);
    expect(startOfWeek(start).weekday).toBe(1);
    expect(start.weekday).toBe(1);
    expect(end.toISODate()).toBe("2026-11-02");
  });

  it("falls back to Moscow for an unknown zone", () => {
    expect(parseTimezone("Mars/Olympus")).toBe("Europe/Moscow");
  });
});
