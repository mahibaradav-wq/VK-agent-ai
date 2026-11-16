import { redirect } from "next/navigation";

export default function LegacyQueuePage() {
  redirect("/app/calendar");
}
