"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ShopKind } from "@prisma/client";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createProductService } from "@/modules/products/product-service";
import { productStudioHref } from "@/modules/products/product-prompt";
import { shopKinds } from "@/modules/products/shop-url";
import { prisma } from "@/server/db/prisma";

export type ProductFormState = {
  status: "idle" | "invalid" | "success";
  message: string;
};

async function requireUserId() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AccessError(403, "Нужна авторизация.");
  }
  return session.user.id;
}

function readField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readShop(formData: FormData): ShopKind {
  const shop = readField(formData, "shop");
  if (!(shopKinds as readonly string[]).includes(shop)) {
    throw new AccessError(400, "Неизвестный магазин.");
  }
  return shop as ShopKind;
}

export async function addShopProduct(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  try {
    await createProductService(prisma).addFromUrl(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "projectId"),
      readField(formData, "sourceUrl"),
    );
    revalidatePath("/app/products");
    return { status: "success", message: "Карточка добавлена в список проекта." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось добавить товар.";
    return { status: "invalid", message };
  }
}

export async function removeShopProduct(formData: FormData) {
  try {
    await createProductService(prisma).remove(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "projectId"),
      readField(formData, "productId"),
    );
    revalidatePath("/app/products");
  } catch (error) {
    if (error instanceof AccessError) {
      throw error;
    }
    throw new AccessError(403, "Не удалось убрать товар.");
  }
}

export async function sendProductToStudio(formData: FormData) {
  const userId = await requireUserId();
  const workspaceId = readField(formData, "workspaceId");
  const projectId = readField(formData, "projectId");
  const visual = readField(formData, "visual") === "shop" ? "shop" : "generate";
  const product = await createProductService(prisma).consume(
    userId,
    workspaceId,
    projectId,
    readField(formData, "productId"),
  );
  revalidatePath("/app/products");
  revalidatePath("/app/studio");
  redirect(
    productStudioHref({
      productId: product.id,
      title: product.title,
      shop: product.shop,
      priceText: product.priceText,
      sourceUrl: product.sourceUrl,
      imageUrl: product.imageUrl,
      visual,
    }),
  );
}

export async function connectShopPartner(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  try {
    await createProductService(prisma).connectPartner(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "projectId"),
      readShop(formData),
      readField(formData, "token"),
    );
    revalidatePath("/app/connections");
    return { status: "success", message: "Партнёрский кабинет сохранён (зашифрован)." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось сохранить кабинет.";
    return { status: "invalid", message };
  }
}

export async function disconnectShopPartner(formData: FormData) {
  try {
    await createProductService(prisma).disconnectPartner(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "projectId"),
      readShop(formData),
    );
    revalidatePath("/app/connections");
  } catch (error) {
    if (error instanceof AccessError) {
      throw error;
    }
    throw new AccessError(403, "Не удалось отключить кабинет.");
  }
}
