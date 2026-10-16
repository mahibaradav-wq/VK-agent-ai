"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import {
  connectTelegram,
  createSetupAccount,
  disconnectSocial,
  type SocialFormState,
} from "@/modules/social/actions";
import { socialPlatformCatalog } from "@/modules/social/catalog";

const idle: SocialFormState = { status: "idle", message: "" };

export type SocialAccountView = {
  id: string;
  platform: string;
  displayName: string;
  externalId: string;
  status: string;
  lastError: string | null;
  hasToken: boolean;
  projectName: string | null;
  capabilities: Array<{ name: string; enabled: boolean }>;
};

export function SocialAccountsBoard({
  workspaceId,
  projectId,
  accounts,
  canConnect,
}: {
  workspaceId: string;
  projectId?: string;
  accounts: SocialAccountView[];
  canConnect: boolean;
}) {
  const [setupState, setupAction, setupPending] = useActionState(createSetupAccount, idle);
  const [connectState, connectAction, connectPending] = useActionState(connectTelegram, idle);
  const [disconnectState, disconnectAction, disconnectPending] = useActionState(disconnectSocial, idle);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <div className="grid gap-4">
        {accounts.length === 0 ? (
          <StatusBanner tone="info">Пока нет социальных аккаунтов. Без токена публикация не имитируется.</StatusBanner>
        ) : null}
        {accounts.map((account) => (
          <Card key={account.id} className="grid gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
              {account.platform} · {account.status}
            </p>
            <h2 className="text-xl font-black text-ink">{account.displayName}</h2>
            <p className="text-sm text-ink/70">
              {account.externalId ? `externalId: ${account.externalId}` : "externalId не задан"}
              {account.projectName ? ` · проект ${account.projectName}` : ""}
            </p>
            <p className="text-sm text-ink/70">Токен в браузере: {account.hasToken ? "есть (зашифрован на сервере)" : "нет"}</p>
            <p className="text-sm text-ink/70">
              Capabilities:{" "}
              {account.capabilities.map((item) => `${item.name}${item.enabled ? "" : " (выкл)"}`).join(", ") || "нет"}
            </p>
            {account.lastError ? <p className="text-sm text-ink/60">{account.lastError}</p> : null}
            {canConnect ? (
              <form action={disconnectAction}>
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="accountId" value={account.id} />
                <Button type="submit" variant="secondary" disabled={disconnectPending}>
                  Отключить
                </Button>
              </form>
            ) : null}
          </Card>
        ))}
        {disconnectState.message ? (
          <StatusBanner tone={disconnectState.status === "success" ? "success" : "warning"}>
            {disconnectState.message}
          </StatusBanner>
        ) : null}
      </div>

      <div className="grid gap-4">
        <Card className="grid gap-3">
          <h2 className="text-xl font-black text-ink">Исследование платформ</h2>
          <ul className="grid gap-2 text-sm text-ink/70">
            {socialPlatformCatalog.map((item) => (
              <li key={item.id}>
                <span className="font-semibold text-ink">{item.label}</span>
                {item.first ? " — первая интеграция. " : " — не в этом этапе. "}
                {item.officialAuth}. Пароль пользователя не принимается.
              </li>
            ))}
          </ul>
        </Card>

        {canConnect ? (
          <>
            <Card>
              <h2 className="text-xl font-black text-ink">Подключить Telegram</h2>
              <p className="mt-2 text-sm text-ink/70">
                Официальный путь: создайте бота в @BotFather и укажите chat_id канала или чата, куда бот может писать.
                Поля «пароль Telegram» нет.
              </p>
              <form action={connectAction} className="mt-4 grid gap-4">
                <input type="hidden" name="workspaceId" value={workspaceId} />
                {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
                <label className="grid gap-2 text-sm font-medium text-ink">
                  Токен бота (@BotFather)
                  <input
                    name="botToken"
                    type="password"
                    autoComplete="off"
                    required
                    className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium text-ink">
                  Chat ID или @channel
                  <input
                    name="chatId"
                    required
                    className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium text-ink">
                  Название
                  <input name="displayName" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal" />
                </label>
                {connectState.message ? (
                  <StatusBanner tone={connectState.status === "success" ? "success" : "warning"}>
                    {connectState.message}
                  </StatusBanner>
                ) : null}
                <Button disabled={connectPending}>{connectPending ? "Проверяем у Telegram..." : "Подключить через Bot API"}</Button>
              </form>
            </Card>

            <Card>
              <h2 className="text-xl font-black text-ink">Аккаунт без токена</h2>
              <p className="mt-2 text-sm text-ink/70">
                Создаёт SocialAccount со статусом requires_setup. Очередь получит integration_not_configured, не фиктивный успех.
              </p>
              <form action={setupAction} className="mt-4 grid gap-4">
                <input type="hidden" name="workspaceId" value={workspaceId} />
                {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
                <label className="grid gap-2 text-sm font-medium text-ink">
                  Платформа
                  <select name="platform" defaultValue="telegram" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4">
                    <option value="telegram">Telegram</option>
                    <option value="vk">ВКонтакте (пока requires_setup)</option>
                  </select>
                </label>
                {setupState.message ? (
                  <StatusBanner tone={setupState.status === "success" ? "success" : "warning"}>
                    {setupState.message}
                  </StatusBanner>
                ) : null}
                <Button variant="secondary" disabled={setupPending}>
                  {setupPending ? "Создаём..." : "Создать requires_setup"}
                </Button>
              </form>
            </Card>
          </>
        ) : (
          <StatusBanner tone="info">Подключать интеграции могут Admin и Owner. Viewer и Editor только смотрят.</StatusBanner>
        )}
      </div>
    </div>
  );
}
