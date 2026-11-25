/**
 * Shared JWT sessionVersion helpers for Node and Edge.
 * Edge middleware must not trust a stale JWT after password reset;
 * validation uses the same comparison as the Node jwt callback.
 */

export type SessionTokenLike = {
  sub?: string | null;
  sessionVersion?: unknown;
};

export function readTokenSessionVersion(token: SessionTokenLike): number {
  return typeof token.sessionVersion === "number" && Number.isInteger(token.sessionVersion)
    ? token.sessionVersion
    : 0;
}

export function stampTokenSessionVersion<T extends SessionTokenLike>(
  token: T,
  user: { id: string; sessionVersion?: unknown },
): T {
  token.sub = user.id;
  (token as SessionTokenLike).sessionVersion =
    typeof user.sessionVersion === "number" && Number.isInteger(user.sessionVersion)
      ? user.sessionVersion
      : 0;
  return token;
}

/**
 * Returns a fresh empty token when the user is missing or sessionVersion drifted
 * (password reset / forced logout). Same rule for Node jwt and Edge session-check.
 */
export function resolveSessionToken<T extends SessionTokenLike>(
  token: T,
  currentSessionVersion: number | null | undefined,
): T | Record<string, never> {
  if (!token.sub) {
    return token;
  }
  if (currentSessionVersion == null) {
    return {};
  }
  if (currentSessionVersion !== readTokenSessionVersion(token)) {
    return {};
  }
  return token;
}

export async function loadUserSessionVersion(
  userId: string,
  lookup: (id: string) => Promise<{ sessionVersion: number } | null>,
): Promise<number | null> {
  const row = await lookup(userId);
  return row ? row.sessionVersion : null;
}
