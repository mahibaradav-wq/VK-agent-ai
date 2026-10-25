import { Card } from "@/components/ui/card";
import { EnqueueForm } from "@/components/app/enqueue-form";

export function PublishPanel({
  workspaceId,
  postId,
  postStatus,
  canEnqueue,
  canPublishNow,
  targets,
  job,
}: {
  workspaceId: string;
  postId: string;
  postStatus: string;
  canEnqueue: boolean;
  canPublishNow: boolean;
  targets: Array<{ platform: string; status: string; lastError: string | null }>;
  job: {
    status: string;
    attemptCount: number;
    maxAttempts: number;
    lastError: string | null;
    attempts: Array<{ platform: string; kind: string; attemptNumber: number; errorCode: string | null }>;
  } | null;
}) {
  return (
    <Card className="grid gap-3">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Публикация</p>
      <p className="text-sm text-ink/70">Статус поста: {postStatus}. Telegram подставится сам, если цель не отмечена.</p>
      <p className="text-sm text-ink/70">
        Цели: {targets.map((target) => `${target.platform}:${target.status}`).join(", ") || "не выбраны"}
      </p>
      {job ? (
        <div className="text-sm text-ink/70">
          <p>
            Задача: {job.status} · попытка {job.attemptCount}/{job.maxAttempts}
          </p>
          {job.lastError ? <p className="mt-1">{job.lastError}</p> : null}
          <ul className="mt-2 grid gap-1">
            {job.attempts.slice(0, 6).map((attempt, index) => (
              <li key={`${attempt.platform}-${attempt.attemptNumber}-${index}`}>
                #{attempt.attemptNumber} {attempt.platform}: {attempt.kind}
                {attempt.errorCode ? ` (${attempt.errorCode})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-ink/60">Задачи ещё нет. Очередь создаст PublishJob с уникальным ключом версии.</p>
      )}
      <p className="text-xs text-ink/60">
        Owner и Admin могут опубликовать сразу. Editor по-прежнему идёт через согласование. Без официальной интеграции
        адаптер не имитирует успех.
      </p>
      <EnqueueForm
        workspaceId={workspaceId}
        postId={postId}
        canEnqueue={canEnqueue}
        canPublishNow={canPublishNow}
        postStatus={postStatus}
      />
    </Card>
  );
}
