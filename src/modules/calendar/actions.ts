"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createCalendarService } from "@/modules/calendar/calendar-service";
import { parseTimezone, TIMEZONE_COOKIE } from "@/modules/calendar/timezone";
import { prisma } from "@/server/db/prisma";

export type CalendarFormState = {
  status: "idle" | "invalid" | "success";
  message: string;
};

async function requireUserId() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AccessError(403, "Нужна авторизация.");
  }
  return session.user.id;
}

function readField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function selectTimezone(formData: FormData) {
  const timezone = parseTimezone(readField(formData, "timezone"));
  const cookieStore = await cookies();
  cookieStore.set(TIMEZONE_COOKIE, timezone, { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/app/calendar");
}

export async function createOnDate(formData: FormData) {
  const timezone = parseTimezone(readField(formData, "timezone"));
  const date = readField(formData, "date");
  await createCalendarService(prisma).createOnDate(
    await requireUserId(),
    readField(formData, "workspaceId"),
    readField(formData, "projectId"),
    { date, timezone, title: readField(formData, "title") },
  );
  redirect(`/app/calendar?view=day&date=${encodeURIComponent(date)}`);
}

export async function reschedulePost(_prev: CalendarFormState, formData: FormData): Promise<CalendarFormState> {
  try {
    await createCalendarService(prisma).schedule(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "postId"),
      {
        localDateTime: readField(formData, "localDateTime"),
        timezone: readField(formData, "timezone"),
      },
    );
    revalidatePath("/app/calendar");
    revalidatePath("/app/posts");
    return { status: "success", message: "Расписание обновлено. Время сохранено в UTC." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось изменить расписание.";
    return { status: "invalid", message };
  }
}
