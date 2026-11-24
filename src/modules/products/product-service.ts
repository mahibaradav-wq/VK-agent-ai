import type { PrismaClient, ShopKind } from "@prisma/client";

import { AccessError, assertActiveProject, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { fetchShopCard } from "@/modules/products/shop-fetch";
import { parseShopProductUrl, ShopUrlError } from "@/modules/products/shop-url";
import { encryptToken } from "@/server/crypto/token-cipher";

export type PublicShopProduct = {
  id: string;
  shop: ShopKind;
  sourceUrl: string;
  title: string;
  priceText: string | null;
  imageUrl: string | null;
};

export type PublicShopPartner = {
  shop: ShopKind;
  connected: boolean;
  status: string;
};

export function createProductService(db: PrismaClient) {
  const access = createAccessService(db);

  async function loadProject(workspaceId: string, projectId: string) {
    const project = await db.project.findUnique({ where: { id: projectId } });
    assertActiveProject(workspaceId, project);
    return project;
  }

  return {
    async list(userId: string, workspaceId: string, projectId: string) {
      await access.requirePermission(userId, workspaceId, "project.view");
      await loadProject(workspaceId, projectId);
      const rows = await db.shopProduct.findMany({
        where: { workspaceId, projectId, consumedAt: null },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(
        (row): PublicShopProduct => ({
          id: row.id,
          shop: row.shop,
          sourceUrl: row.sourceUrl,
          title: row.title,
          priceText: row.priceText,
          imageUrl: row.imageUrl,
        }),
      );
    },

    async addFromUrl(userId: string, workspaceId: string, projectId: string, rawUrl: string) {
      await access.requirePermission(userId, workspaceId, "post.create");
      await loadProject(workspaceId, projectId);
      let parsed;
      try {
        parsed = parseShopProductUrl(rawUrl);
      } catch (error) {
        throw new AccessError(400, error instanceof ShopUrlError ? error.message : "Не удалось разобрать ссылку.");
      }

      const snapshot = await fetchShopCard(parsed.canonicalUrl);
      const title = snapshot.title || parsed.titleGuess;
      const existing = await db.shopProduct.findUnique({
        where: { projectId_canonicalUrl: { projectId, canonicalUrl: parsed.canonicalUrl } },
      });
      if (existing && !existing.consumedAt) {
        throw new AccessError(400, "Эта карточка уже в списке проекта.");
      }

      const data = {
        workspaceId,
        projectId,
        shop: parsed.shop,
        sourceUrl: parsed.sourceUrl,
        canonicalUrl: parsed.canonicalUrl,
        title,
        priceText: snapshot.priceText || null,
        imageUrl: snapshot.imageUrl || null,
        consumedAt: null,
      };

      const row = existing
        ? await db.shopProduct.update({ where: { id: existing.id }, data })
        : await db.shopProduct.create({ data });

      return {
        id: row.id,
        shop: row.shop,
        sourceUrl: row.sourceUrl,
        title: row.title,
        priceText: row.priceText,
        imageUrl: row.imageUrl,
      } satisfies PublicShopProduct;
    },

    async refresh(userId: string, workspaceId: string, projectId: string, productId: string) {
      await access.requirePermission(userId, workspaceId, "post.create");
      const product = await db.shopProduct.findUnique({ where: { id: productId } });
      assertWorkspaceBound(workspaceId, product, "Товар");
      if (product.projectId !== projectId || product.consumedAt) {
        throw new AccessError(404, "Товар не найден в этом проекте.");
      }
      await loadProject(workspaceId, product.projectId);
      const snapshot = await fetchShopCard(product.canonicalUrl);
      return db.shopProduct.update({
        where: { id: product.id },
        data: {
          title: snapshot.title || product.title,
          priceText: snapshot.priceText || product.priceText,
          imageUrl: snapshot.imageUrl || product.imageUrl,
        },
      });
    },

    async consume(userId: string, workspaceId: string, projectId: string, productId: string) {
      await access.requirePermission(userId, workspaceId, "post.create");
      const product = await db.shopProduct.findUnique({ where: { id: productId } });
      assertWorkspaceBound(workspaceId, product, "Товар");
      if (product.projectId !== projectId || product.consumedAt) {
        throw new AccessError(404, "Товар не найден в этом проекте.");
      }
      await loadProject(workspaceId, product.projectId);
      const snapshot = await fetchShopCard(product.canonicalUrl);
      return db.shopProduct.update({
        where: { id: product.id },
        data: {
          consumedAt: new Date(),
          title: snapshot.title || product.title,
          priceText: snapshot.priceText || product.priceText,
          imageUrl: snapshot.imageUrl || product.imageUrl,
        },
      });
    },

    async attachToPost(userId: string, workspaceId: string, productId: string, postId: string) {
      await access.requirePermission(userId, workspaceId, "post.create");
      const product = await db.shopProduct.findUnique({ where: { id: productId } });
      assertWorkspaceBound(workspaceId, product, "Товар");
      const post = await db.post.findUnique({ where: { id: postId } });
      assertWorkspaceBound(workspaceId, post, "Публикация");
      if (post.projectId !== product.projectId) {
        throw new AccessError(403, "Товар принадлежит другому проекту.");
      }
      await loadProject(workspaceId, product.projectId);
      return db.shopProduct.update({
        where: { id: product.id },
        data: { postId: post.id, consumedAt: product.consumedAt ?? new Date() },
      });
    },

    async remove(userId: string, workspaceId: string, projectId: string, productId: string) {
      await access.requirePermission(userId, workspaceId, "post.create");
      const product = await db.shopProduct.findUnique({ where: { id: productId } });
      assertWorkspaceBound(workspaceId, product, "Товар");
      if (product.projectId !== projectId) {
        throw new AccessError(404, "Товар не найден в этом проекте.");
      }
      await loadProject(workspaceId, product.projectId);
      await db.shopProduct.delete({ where: { id: product.id } });
    },

    async listPartners(userId: string, workspaceId: string, projectId: string) {
      await access.requirePermission(userId, workspaceId, "social.view");
      await loadProject(workspaceId, projectId);
      const rows = await db.shopPartnerCredential.findMany({ where: { workspaceId, projectId } });
      const byShop = new Map(rows.map((row) => [row.shop, row]));
      return (["ozon", "wildberries", "market", "magnit"] as ShopKind[]).map(
        (shop): PublicShopPartner => ({
          shop,
          connected: Boolean(byShop.get(shop)),
          status: byShop.get(shop)?.status ?? "не задано",
        }),
      );
    },

    async connectPartner(
      userId: string,
      workspaceId: string,
      projectId: string,
      shop: ShopKind,
      token: string,
    ) {
      await access.requirePermission(userId, workspaceId, "social.connect");
      await loadProject(workspaceId, projectId);
      const value = token.trim();
      if (value.length < 4) {
        throw new AccessError(400, "Вставьте идентификатор партнёрского кабинета магазина.");
      }
      const encryptedToken = encryptToken(value);
      await db.shopPartnerCredential.upsert({
        where: { projectId_shop: { projectId, shop } },
        create: {
          workspaceId,
          projectId,
          shop,
          encryptedToken,
          status: "connected",
          lastError: null,
          connectedById: userId,
        },
        update: {
          encryptedToken,
          status: "connected",
          lastError: null,
          connectedById: userId,
        },
      });
    },

    async disconnectPartner(userId: string, workspaceId: string, projectId: string, shop: ShopKind) {
      await access.requirePermission(userId, workspaceId, "social.connect");
      await loadProject(workspaceId, projectId);
      await db.shopPartnerCredential.deleteMany({ where: { workspaceId, projectId, shop } });
    },
  };
}
