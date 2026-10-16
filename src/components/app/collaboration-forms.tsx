"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import {
  addPostComment,
  approvePost,
  assignApproverProjects,
  inviteMember,
  rejectPost,
  submitPostForApproval,
  type CollaborationFormState,
} from "@/modules/collaboration/actions";

const idle: CollaborationFormState = { status: "idle", message: "" };

export function InvitationForm({
  workspaceId,
  roleOptions,
  projects,
}: {
  workspaceId: string;
  roleOptions: Array<{ value: string; label: string }>;
  projects: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(inviteMember, idle);
  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="grid gap-2 text-sm font-medium text-ink">
        Email
        <input name="email" type="email" required className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4" />
      </label>
      <label className="grid gap-2 text-sm font-medium text-ink">
        Роль
        <select name="role" defaultValue="Viewer" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4">
          {roleOptions.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
      </label>
      {projects.length > 0 ? (
        <fieldset className="grid gap-2 text-sm">
          <legend className="font-medium text-ink">Проекты для Approver</legend>
          {projects.map((project) => (
            <label key={project.id} className="flex items-center gap-2">
              <input type="checkbox" name="projectId" value={project.id} />
              {project.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>
          {state.message}
          {state.mailboxUrl ? (
            <p className="mt-1">
              <a href={state.mailboxUrl} className="font-semibold text-brand-dark">
                Открыть почтовый стенд
              </a>
            </p>
          ) : null}
        </StatusBanner>
      ) : null}
      <Button disabled={pending}>{pending ? "Отправляем..." : "Пригласить"}</Button>
    </form>
  );
}

export function ApproverProjectsForm({
  workspaceId,
  userId,
  projects,
  selectedIds,
}: {
  workspaceId: string;
  userId: string;
  projects: Array<{ id: string; name: string }>;
  selectedIds: string[];
}) {
  const [state, formAction, pending] = useActionState(assignApproverProjects, idle);
  return (
    <form action={formAction} className="mt-4 grid gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="userId" value={userId} />
      {projects.map((project) => (
        <label key={project.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="projectId" value={project.id} defaultChecked={selectedIds.includes(project.id)} />
          {project.name}
        </label>
      ))}
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Сохраняем..." : "Сохранить проекты"}
      </Button>
    </form>
  );
}

export function ApprovalPanel({
  workspaceId,
  postId,
  postStatus,
  canSubmit,
  canApprove,
  versionLabel,
}: {
  workspaceId: string;
  postId: string;
  postStatus: string;
  canSubmit: boolean;
  canApprove: boolean;
  versionLabel: string;
}) {
  const [submitState, submitAction, submitPending] = useActionState(submitPostForApproval, idle);
  const [approveState, approveAction, approvePending] = useActionState(approvePost, idle);
  const [rejectState, rejectAction, rejectPending] = useActionState(rejectPost, idle);
  const message = submitState.message || approveState.message || rejectState.message;
  const tone = [submitState, approveState, rejectState].some((item) => item.status === "invalid") ? "warning" : "success";

  return (
    <Card className="grid gap-3">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Согласование</p>
      <p className="text-sm text-ink/70">
        Статус: {postStatus} · {versionLabel}
      </p>
      {message ? <StatusBanner tone={tone}>{message}</StatusBanner> : null}
      {canSubmit && ["draft", "scheduled", "failed"].includes(postStatus) ? (
        <form action={submitAction}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="postId" value={postId} />
          <Button disabled={submitPending}>{submitPending ? "Отправляем..." : "Отправить на согласование"}</Button>
        </form>
      ) : null}
      {canApprove && postStatus === "pending_approval" ? (
        <div className="grid gap-3">
          <form action={approveAction} className="grid gap-3">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="postId" value={postId} />
            <label className="grid gap-2 text-sm font-medium text-ink">
              Комментарий к решению
              <input name="note" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4" />
            </label>
            <Button disabled={approvePending}>{approvePending ? "Согласуем..." : "Согласовать версию"}</Button>
          </form>
          <form action={rejectAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="postId" value={postId} />
            <input type="hidden" name="note" value="Отклонено" />
            <Button type="submit" variant="secondary" disabled={rejectPending}>
              {rejectPending ? "Отклоняем..." : "Отклонить"}
            </Button>
          </form>
        </div>
      ) : null}
      {!canSubmit && !canApprove ? (
        <StatusBanner tone="info">Viewer не меняет статус согласования.</StatusBanner>
      ) : null}
    </Card>
  );
}

export function CommentThread({
  workspaceId,
  postId,
  canComment,
  comments,
}: {
  workspaceId: string;
  postId: string;
  canComment: boolean;
  comments: Array<{ id: string; body: string; createdAt: string; authorEmail: string }>;
}) {
  const [state, formAction, pending] = useActionState(addPostComment, idle);
  return (
    <Card className="grid gap-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Комментарии</p>
      {comments.length === 0 ? <p className="text-sm text-ink/60">Комментариев пока нет.</p> : null}
      {comments.map((comment) => (
        <div key={comment.id} className="rounded-2xl bg-sand-50 p-3 text-sm">
          <p className="font-semibold text-ink">{comment.authorEmail}</p>
          <p className="mt-1 whitespace-pre-wrap text-ink/80">{comment.body}</p>
          <p className="mt-1 text-xs text-ink/50">{comment.createdAt}</p>
        </div>
      ))}
      {canComment ? (
        <form action={formAction} className="grid gap-3">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="postId" value={postId} />
          <label className="grid gap-2 text-sm font-medium text-ink">
            Новый комментарий
            <textarea name="body" required minLength={2} className="min-h-24 rounded-2xl border border-ink/10 bg-white px-4 py-3" />
          </label>
          {state.message ? (
            <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
          ) : null}
          <Button disabled={pending}>{pending ? "Сохраняем..." : "Комментировать"}</Button>
        </form>
      ) : (
        <StatusBanner tone="info">Комментировать могут Editor, Approver, Admin и Owner. Viewer — только чтение.</StatusBanner>
      )}
    </Card>
  );
}
