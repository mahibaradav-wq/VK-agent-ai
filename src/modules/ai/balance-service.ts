import type { PrismaClient } from "@prisma/client";

import { AccessError } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { formatUsd } from "@/lib/format-usd";
import { fetchAiBalance, type AiBalanceResult } from "@/server/ai/balance";
import { getAiProviderSpec } from "@/server/ai/catalog";
import { decryptToken } from "@/server/crypto/token-cipher";

export type PublicAiBalance = AiBalanceResult & {
  hasKey: boolean;
  label: string;
};

const cache = new Map<string, { at: number; value: PublicAiBalance }>();
const CACHE_MS = 60_000;

function navLabel(balance: PublicAiBalance) {
  if (!balance.hasKey) {
    return "API нет ключа";
  }
  if (balance.remainingUsd == null) {
    return "API ?";
  }
  return `API ${formatUsd(balance.remainingUsd)}`;
}

export function aiBalanceNavLabel(balance: PublicAiBalance) {
  return navLabel(balance);
}

export function clearAiBalanceCache(workspaceId?: string) {
  if (workspaceId) {
    cache.delete(workspaceId);
    return;
  }
  cache.clear();
}

export function createAiBalanceService(
  db: PrismaClient,
  options?: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
    envApiKey?: string;
    envBaseUrl?: string;
  },
) {
  const access = createAccessService(db);
  const now = options?.now ?? (() => new Date());

  async function credentials(workspaceId: string) {
    const row = await db.workspaceAiConnection.findUnique({
      where: { workspaceId_provider: { workspaceId, provider: "openai" } },
    });
    if (row?.encryptedApiKey && row.status === "connected") {
      const spec = getAiProviderSpec("openai");
      return { apiKey: decryptToken(row.encryptedApiKey), baseUrl: spec.baseUrl, hasKey: true };
    }
    const envKey = (options?.envApiKey ?? process.env.AI_API_KEY)?.trim();
    if (envKey) {
      return {
        apiKey: envKey,
        baseUrl: (options?.envBaseUrl ?? process.env.AI_BASE_URL)?.trim() || "https://api.openai.com/v1",
        hasKey: true,
      };
    }
    return { apiKey: "", baseUrl: "", hasKey: false };
  }

  return {
    async read(userId: string, workspaceId: string, input?: { refresh?: boolean }): Promise<PublicAiBalance> {
      await access.requirePermission(userId, workspaceId, "ai.view");
      if (!input?.refresh) {
        const cached = cache.get(workspaceId);
        if (cached && now().getTime() - cached.at < CACHE_MS) {
          return cached.value;
        }
      }

      const creds = await credentials(workspaceId);
      if (!creds.hasKey) {
        const value: PublicAiBalance = {
          remainingUsd: null,
          source: "none",
          hasKey: false,
          label: "API нет ключа",
          message: "Ключ ChatGPT задаётся в Подключениях. Без ключа остаток не читается.",
        };
        cache.set(workspaceId, { at: now().getTime(), value });
        return value;
      }

      const fetched = await fetchAiBalance({
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        fetchImpl: options?.fetchImpl,
        now,
      });
      const value: PublicAiBalance = {
        ...fetched,
        hasKey: true,
        label: navLabel({ ...fetched, hasKey: true, label: "" }),
      };
      cache.set(workspaceId, { at: now().getTime(), value });
      return value;
    },
  };
}

export async function safeAiBalanceLabel(
  read: () => Promise<PublicAiBalance>,
): Promise<string> {
  try {
    return aiBalanceNavLabel(await read());
  } catch (error) {
    if (error instanceof AccessError) {
      return "API";
    }
    return "API ?";
  }
}
