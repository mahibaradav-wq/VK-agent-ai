"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import {
  bindTelegramChannel,
  connectTelegram,
  connectVk,
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
  const [bindState, bindAction, bindPending] = useActionState(bindTelegramChannel, idle);
  const [vkState, vkAction, vkPending] = useActionState(connectVk, idle);
  const [disconnectState, disconnectAction, disconnectPending] = useActionState(disconnectSocial, idle);
  const existingVk = accounts.find((item) => item.platform === "vk" && item.status !== "disconnected");

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
            {account.platform === "telegram" && account.hasToken && !account.externalId ? (
              <p className="text-sm text-ink/70">
                Бот сохранён. Сам по себе он не канал: посты выйдут в t.me/dom_po_polochkam, когда канал будет привязан.
              </p>
            ) : null}
            {account.platform === "telegram" && account.externalId ? (
              <p className="text-sm text-ink/70">
                Канал привязан. Публикация идёт туда от имени бота, который уже администратор.
              </p>
            ) : null}
            {account.platform === "vk" ? (
              <p className="text-sm text-ink/70">
                {account.capabilities.some((item) => item.name === "publish_carousel" && item.enabled)
                  ? "Карусель фото: пользовательский ключ админа сохранён. Новые слайды из Студии уйдут как фото на стене."
                  : "Карусель фото: ключ клуба умеет повесить уже лежащие на стене фото, но не загрузить новые. Ручная карусель в ВК идёт от вашего входа, не от ключа клуба. Для Студии нужен пользовательский ключ админа с правом «Фотографии»."}
              </p>
            ) : null}
            {account.lastError ? <p className="text-sm text-ink/60">{account.lastError}</p> : null}
            {canConnect && account.platform === "telegram" && account.hasToken ? (
              <form action={bindAction} className="grid gap-3">
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="accountId" value={account.id} />
                {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
                <label className="grid gap-2 text-sm font-medium text-ink">
                  Канал
                  <input
                    name="chatId"
                    required
                    defaultValue={account.externalId ? "" : "@dom_po_polochkam"}
                    placeholder="https://t.me/dom_po_polochkam"
                    className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
                  />
                </label>
                {bindState.message ? (
                  <StatusBanner tone={bindState.status === "success" ? "success" : "warning"}>{bindState.message}</StatusBanner>
                ) : null}
                <Button type="submit" variant="secondary" disabled={bindPending}>
                  {bindPending ? "Проверяем канал..." : account.externalId ? "Сменить канал" : "Привязать канал к проекту"}
                </Button>
              </form>
            ) : null}
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
                {item.first ? " — первая интеграция. " : " — стена сообщества. "}
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
                Токен от @BotFather и канал t.me/dom_po_polochkam. Бот уже должен быть администратором канала. Пароль
                Telegram не принимается.
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
                  Канал
                  <input
                    name="chatId"
                    required
                    defaultValue="@dom_po_polochkam"
                    placeholder="https://t.me/dom_po_polochkam"
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
              <h2 className="text-xl font-black text-ink">
                {existingVk ? "Обновить ключи ВКонтакте" : "Подключить ВКонтакте"}
              </h2>
              <p className="mt-2 text-sm text-ink/70">
                Ключ сообщества (Управление → Настройки → Работа с API, права «Стена» и «Документы») пишет текст и
                умеет прикрепить фото, которые уже есть в сообществе. Загрузить новые слайды в альбом стены он не может:
                VK отвечает ошибкой 27 на photos.getWallUploadServer. В браузере карусель получается потому, что вы
                вошли как админ. Для Студии вставьте пользовательский ключ этого админа с правом «Фотографии». Право
                photos выдаёт поддержка VK: https://vk.ru/support?act=new&from=api. Не сервисный ключ приложения и не
                пароль.
              </p>
              <form action={vkAction} className="mt-4 grid gap-4">
                <input type="hidden" name="workspaceId" value={workspaceId} />
                {existingVk ? <input type="hidden" name="accountId" value={existingVk.id} /> : null}
                {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
                <label className="grid gap-2 text-sm font-medium text-ink">
                  Ключ сообщества
                  <input
                    name="communityToken"
                    type="password"
                    autoComplete="off"
                    required
                    className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium text-ink">
                  Пользовательский ключ админа для карусели
                  <input
                    name="photoToken"
                    type="password"
                    autoComplete="off"
                    placeholder="необязательно, без него карусель фото не выйдет"
                    className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium text-ink">
                  Сообщество
                  <input
                    name="source"
                    required
                    placeholder="https://vk.com/club242155421"
                    className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium text-ink">
                  Название
                  <input name="displayName" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal" />
                </label>
                {vkState.message ? (
                  <StatusBanner tone={vkState.status === "success" ? "success" : "warning"}>{vkState.message}</StatusBanner>
                ) : null}
                <Button disabled={vkPending}>
                  {vkPending ? "Проверяем у VK..." : existingVk ? "Сохранить ключи ВК" : "Подключить стену ВК"}
                </Button>
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
                    <option value="vk">ВКонтакте (без ключа)</option>
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
