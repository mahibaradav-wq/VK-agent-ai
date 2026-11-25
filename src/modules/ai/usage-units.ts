/** Worst-case chat/completions calls for one post generate (draft + length revise). */
export const MAX_POST_COMPLETION_CALLS = 2;

export function textGenerateReserveUnits(kind: string) {
  return kind === "post" ? MAX_POST_COMPLETION_CALLS : 1;
}

export function paidCallsFromResult(result: { paidCalls?: number }, fallback = 1) {
  const value = result.paidCalls;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
}

export function paidCallsFromError(error: unknown) {
  if (error && typeof error === "object" && "paidCalls" in error) {
    const value = (error as { paidCalls?: unknown }).paidCalls;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      return value;
    }
  }
  return 0;
}

export function attachPaidCalls<T extends Error>(error: T, paidCalls: number): T & { paidCalls: number } {
  Object.defineProperty(error, "paidCalls", {
    value: paidCalls,
    enumerable: true,
    configurable: true,
  });
  return error as T & { paidCalls: number };
}
