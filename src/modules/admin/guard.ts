import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";

export async function loadAdminPage<T>(loader: (userId: string) => Promise<T>) {
  const session = await auth();
  if (!session?.user?.id) {
    return { userId: null as string | null, data: null as T | null, error: "Нужна авторизация." };
  }
  try {
    return { userId: session.user.id, data: await loader(session.user.id), error: null as string | null };
  } catch (error) {
    if (error instanceof AccessError) {
      return { userId: session.user.id, data: null as T | null, error: error.message };
    }
    throw error;
  }
}
