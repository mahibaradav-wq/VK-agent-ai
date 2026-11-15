import type { PrismaClient } from "@prisma/client";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { aiProviderCatalog, getAiProviderSpec, parseAiProviderId, type AiProviderId } from "@/server/ai/catalog";
import { createOpenAiCompatibleProvider } from "@/server/ai/openai-compatible";
import { probeAiApiKey } from "@/server/ai/probe";
import { getAiProvider, type AiProvider } from "@/server/ai";
import { createUnconfiguredAiProvider } from "@/server/ai/unconfigured";
import { decryptToken, encryptToken } from "@/server/crypto/token-cipher";

export type AiRole = "ideas" | "copy" | "image";

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

export type PublicAiWorkspace = {
  connections: PublicAiConnection[];
  ideas: PublicAiConnection;
  copy: PublicAiConnection;
  image: PublicAiConnection;
};

const ROLE_ORDER: Record<AiRole, readonly AiProviderId[]> = {
  ideas: ["deepseek", "qwen", "openai"],
  copy: ["openai", "qwen", "deepseek"],
  image: ["openai", "qwen"],
};

function looksLikeApiKey(value: string) {
  return /^sk-[A-Za-z0-9_-]{8,}$/.test(value.trim());
}

function currentImageModel(spec: { imageModel: string }, stored: string) {
  if (stored === "dall-e-2" || stored === "dall-e-3" || !stored.trim()) {
    return spec.imageModel;
  }
  return stored;
}

function unconfiguredConnection(): PublicAiConnection {
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

function envAsConnection(envProvider: AiProvider): PublicAiConnection | null {
  if (!envProvider.ready) {
    return null;
  }
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

export function createAiConnectionService(
  db: PrismaClient,
  options?: {
    fetchImpl?: typeof fetch;
    envProvider?: AiProvider;
  },
) {
  const access = createAccessService(db);
  const fetchImpl = options?.fetchImpl;

  async function loadRows(workspaceId: string) {
    return db.workspaceAiConnection.findMany({
      where: { workspaceId, status: "connected" },
      orderBy: { createdAt: "asc" },
    });
  }

  function toPublic(row: {
    provider: string;
    model: string;
    imageModel: string;
    status: string;
    lastError: string | null;
    encryptedApiKey: string;
  }): PublicAiConnection {
    const spec = getAiProviderSpec(row.provider);
    return {
      provider: row.provider,
      label: spec.label,
      model: row.model,
      imageModel: spec.imageReady ? currentImageModel(spec, row.imageModel) : "",
      imageReady: spec.imageReady,
      status: row.status,
      hasKey: Boolean(row.encryptedApiKey),
      lastError: row.lastError,
      source: "workspace",
    };
  }

  function providerFromRow(row: {
    provider: string;
    model: string;
    imageModel: string;
    encryptedApiKey: string;
  }): AiProvider {
    const spec = getAiProviderSpec(row.provider);
    return createOpenAiCompatibleProvider({
      apiKey: decryptToken(row.encryptedApiKey),
      baseUrl: spec.baseUrl,
      model: row.model || spec.model,
      imageModel: currentImageModel(spec, row.imageModel),
      imageReady: spec.imageReady,
      name: spec.id,
      fetchImpl,
    });
  }

  function pickRow<T extends { provider: string }>(
    rows: T[],
    role: AiRole,
  ): T | null {
    for (const id of ROLE_ORDER[role]) {
      const row = rows.find((item) => item.provider === id);
      if (!row) {
        continue;
      }
      if (role === "image" && !getAiProviderSpec(id).imageReady) {
        continue;
      }
      return row;
    }
    return null;
  }

  function summarize(rows: Array<{
    provider: string;
    model: string;
    imageModel: string;
    status: string;
    lastError: string | null;
    encryptedApiKey: string;
  }>, envProvider: AiProvider): PublicAiWorkspace {
    const connections = rows.map(toPublic);
    const env = connections.length === 0 ? envAsConnection(envProvider) : null;
    if (env) {
      connections.push(env);
    }
    const byProvider = new Map(connections.map((item) => [item.provider, item]));
    const pick = (role: AiRole) => {
      for (const id of ROLE_ORDER[role]) {
        const item = byProvider.get(id);
        if (!item) {
          continue;
        }
        if (role === "image" && !item.imageReady) {
          continue;
        }
        return item;
      }
      return unconfiguredConnection();
    };
    return {
      connections,
      ideas: pick("ideas"),
      copy: pick("copy"),
      image: pick("image"),
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
      const rows = await loadRows(workspaceId);
      return summarize(rows, options?.envProvider ?? getAiProvider());
    },

    async resolveProvider(workspaceId: string, role: AiRole = "copy"): Promise<AiProvider> {
      const rows = await loadRows(workspaceId);
      const row = pickRow(rows, role);
      if (row) {
        return providerFromRow(row);
      }
      if (rows.length === 0) {
        const env = options?.envProvider ?? getAiProvider();
        if (role === "image") {
          return env.imageReady ? env : createUnconfiguredAiProvider();
        }
        return env;
      }
      return createUnconfiguredAiProvider();
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
        where: { workspaceId_provider: { workspaceId, provider: spec.id } },
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
      return toPublic(row);
    },

    async disconnect(userId: string, workspaceId: string, provider?: string) {
      await access.requirePermission(userId, workspaceId, "ai.connect");
      if (!provider) {
        const rows = await loadRows(workspaceId);
        if (rows.length === 0) {
          throw new AccessError(404, "AI-подключение не найдено.");
        }
        if (rows.length > 1) {
          throw new AccessError(400, "Укажите, какого провайдера отключить.");
        }
        provider = rows[0]!.provider;
      }
      const row = await db.workspaceAiConnection.findUnique({
        where: { workspaceId_provider: { workspaceId, provider } },
      });
      assertWorkspaceBound(workspaceId, row, "AI-подключение");
      await db.workspaceAiConnection.delete({
        where: { workspaceId_provider: { workspaceId, provider } },
      });
      await db.auditLog.create({
        data: {
          action: "DISCONNECT_AI_PROVIDER",
          entityType: "ai_connection",
          entityId: row.id,
          actorId: userId,
          details: row.provider,
        },
      });
      return unconfiguredConnection();
    },
  };
}
