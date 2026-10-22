import type { PrismaClient } from "@prisma/client";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { aiProviderCatalog, getAiProviderSpec, parseAiProviderId } from "@/server/ai/catalog";
import { createOpenAiCompatibleProvider } from "@/server/ai/openai-compatible";
import { probeAiApiKey } from "@/server/ai/probe";
import { getAiProvider, type AiProvider } from "@/server/ai";
import { decryptToken, encryptToken } from "@/server/crypto/token-cipher";

export type PublicAiConnection = {
  provider: string;
  label: string;
  model: string;
  imageModel: string;
  imageReady: boolean;
  status: string;
  hasKey: boolean;
  lastError: string | null;
  source: "workspace" | "env" | "none";
};

function looksLikeApiKey(value: string) {
  return /^sk-[A-Za-z0-9_-]{8,}$/.test(value.trim());
}

export function createAiConnectionService(
  db: PrismaClient,
  options?: {
    fetchImpl?: typeof fetch;
    envProvider?: AiProvider;
  },
) {
  const access = createAccessService(db);
  const fetchImpl = options?.fetchImpl;

  async function loadConnection(workspaceId: string) {
    return db.workspaceAiConnection.findUnique({ where: { workspaceId } });
  }

  function toPublic(
    row: {
      provider: string;
      model: string;
      imageModel: string;
      status: string;
      lastError: string | null;
      encryptedApiKey: string;
    } | null,
    envProvider: AiProvider,
  ): PublicAiConnection {
    if (row) {
      const spec = getAiProviderSpec(row.provider);
      return {
        provider: row.provider,
        label: spec.label,
        model: row.model,
        imageModel: spec.imageReady ? row.imageModel || spec.imageModel : "",
        imageReady: spec.imageReady,
        status: row.status,
        hasKey: Boolean(row.encryptedApiKey),
        lastError: row.lastError,
        source: "workspace",
      };
    }
    if (envProvider.ready) {
      return {
        provider: envProvider.name,
        label: envProvider.name,
        model: envProvider.model,
        imageModel: envProvider.imageReady ? envProvider.imageModel : "",
        imageReady: envProvider.imageReady,
        status: "connected",
        hasKey: true,
        lastError: null,
        source: "env",
      };
    }
    return {
      provider: "unconfigured",
      label: "не подключён",
      model: "не настроен",
      imageModel: "",
      imageReady: false,
      status: "requires_setup",
      hasKey: false,
      lastError: null,
      source: "none",
    };
  }

  return {
    catalog: aiProviderCatalog,

    async get(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "ai.view");
      const membership = await db.workspaceMember.findFirst({ where: { userId, workspaceId } });
      if (!membership) {
        throw new AccessError(404, "Рабочее пространство не найдено.");
      }
      const row = await loadConnection(workspaceId);
      return toPublic(row, options?.envProvider ?? getAiProvider());
    },

    async resolveProvider(workspaceId: string): Promise<AiProvider> {
      const row = await loadConnection(workspaceId);
      if (row?.encryptedApiKey && row.status === "connected") {
        const spec = getAiProviderSpec(row.provider);
        return createOpenAiCompatibleProvider({
          apiKey: decryptToken(row.encryptedApiKey),
          baseUrl: spec.baseUrl,
          model: row.model || spec.model,
          imageModel: row.imageModel || spec.imageModel,
          imageReady: spec.imageReady,
          name: spec.id,
          fetchImpl,
        });
      }
      return options?.envProvider ?? getAiProvider();
    },

    async connect(userId: string, workspaceId: string, input: { provider: string; apiKey: string }) {
      await access.requirePermission(userId, workspaceId, "ai.connect");
      const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
      assertWorkspaceBound(workspaceId, workspace ? { workspaceId: workspace.id } : null, "Рабочее пространство");

      let providerId: ReturnType<typeof parseAiProviderId>;
      try {
        providerId = parseAiProviderId(input.provider);
      } catch {
        throw new AccessError(400, "Неизвестный AI-провайдер.");
      }

      const apiKey = input.apiKey.trim();
      if (!looksLikeApiKey(apiKey)) {
        throw new AccessError(400, "Нужен API-ключ (sk-...), не пароль от ChatGPT, DeepSeek или Qwen.");
      }

      const spec = getAiProviderSpec(providerId);
      await probeAiApiKey({ apiKey, baseUrl: spec.baseUrl, fetchImpl });
      const encryptedApiKey = encryptToken(apiKey);

      const row = await db.workspaceAiConnection.upsert({
        where: { workspaceId },
        create: {
          workspaceId,
          provider: spec.id,
          encryptedApiKey,
          model: spec.model,
          imageModel: spec.imageModel,
          status: "connected",
          lastError: null,
          connectedById: userId,
        },
        update: {
          provider: spec.id,
          encryptedApiKey,
          model: spec.model,
          imageModel: spec.imageModel,
          status: "connected",
          lastError: null,
          connectedById: userId,
        },
      });
      await db.auditLog.create({
        data: {
          action: "CONNECT_AI_PROVIDER",
          entityType: "ai_connection",
          entityId: row.id,
          actorId: userId,
          details: spec.id,
        },
      });
      return toPublic(row, options?.envProvider ?? getAiProvider());
    },

    async disconnect(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "ai.connect");
      const row = await loadConnection(workspaceId);
      assertWorkspaceBound(workspaceId, row, "AI-подключение");
      await db.workspaceAiConnection.delete({ where: { workspaceId } });
      await db.auditLog.create({
        data: {
          action: "DISCONNECT_AI_PROVIDER",
          entityType: "ai_connection",
          entityId: row.id,
          actorId: userId,
          details: row.provider,
        },
      });
      return toPublic(null, options?.envProvider ?? getAiProvider());
    },
  };
}
