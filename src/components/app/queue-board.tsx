"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { processDueJobs, type PublishFormState } from "@/modules/publishing/actions";

const initialState: PublishFormState = { status: "idle", message: "" };

export type QueueBoardJob = {
  id: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  postId: string;
  title: string;
  postStatus: string;
  targets: Array<{ id: string; platform: string; status: string; lastError: string | null }>;
  attempts: Array<{
    id: string;
    platform: string;
    kind: string;
    attemptNumber: number;
    errorCode: string | null;
    errorMessage: string | null;
    finishedAt: string;
  }>;
};

export function QueueBoard({
  workspaceId,
  jobs,
  canProcess,
}: {
  workspaceId: string;
  jobs: QueueBoardJob[];
  canProcess: boolean;
}) {
  const [state, formAction, pending] = useActionState(processDueJobs, initialState);

  return (
    <div className="grid gap-5">
      {canProcess ? (
        <form action={formAction} className="grid gap-3">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <Button disabled={pending}>{pending ? "Обрабатываем..." : "Обработать очередь и расписание"}</Button>
        </form>
      ) : (
        <StatusBanner tone="info">Запускать обработку могут Editor, Admin и Owner.</StatusBanner>
      )}
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
      ) : null}
      {jobs.length === 0 ? <StatusBanner tone="info">В этом пространстве ещё нет задач публикации.</StatusBanner> : null}
      {jobs.map((job) => (
        <Card key={job.id}>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
            {job.status} · попытка {job.attemptCount}/{job.maxAttempts} · пост {job.postStatus}
          </p>
          <h2 className="mt-2 text-xl font-black text-ink">{job.title}</h2>
          <p className="mt-2 text-sm text-ink/70">
            Цели:{" "}
            {job.targets.map((target) => `${target.platform}:${target.status}`).join(", ") || "нет"}
          </p>
          {job.lastError ? <p className="mt-2 text-sm text-ink/60">{job.lastError}</p> : null}
          {job.nextAttemptAt ? (
            <p className="mt-1 text-sm text-ink/60">Следующая попытка (UTC): {job.nextAttemptAt}</p>
          ) : null}
          <ul className="mt-3 grid gap-1 text-sm text-ink/70">
            {job.attempts.slice(0, 8).map((attempt) => (
              <li key={attempt.id}>
                #{attempt.attemptNumber} {attempt.platform}: {attempt.kind}
                {attempt.errorCode ? ` (${attempt.errorCode})` : ""}
              </li>
            ))}
          </ul>
          <Link href={`/app/posts/${job.postId}`} className="mt-3 inline-block text-sm font-semibold text-brand-dark">
            Открыть публикацию
          </Link>
        </Card>
      ))}
    </div>
  );
}
