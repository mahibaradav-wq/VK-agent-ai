/** Worst-case chat/completions calls for one post generate (draft + length revise). */
export const MAX_POST_COMPLETION_CALLS = 2;

export function textGenerateReserveUnits(kind: string) {
  return kind === "post" ? MAX_POST_COMPLETION_CALLS : 1;
}

/** Worst-case paid units for one provider attempt (one generate / generateImage). */
export function attemptReserveUnits(kind: "image" | string) {
  if (kind === "image") {
    return 1;
  }
  return textGenerateReserveUnits(kind);
}

/**
 * HTTP / transport billing classification for OpenAI-compatible adapters:
 * - **likely_billable**: provider returned an HTTP response (2xx/4xx/5xx). Count 1 unit.
 * - **non_billable**: fetch threw (network / timeout / DNS) before a response — count 0.
 * - **unknown**: treat like non_billable only when no response arrived; once HTTP exists, bill.
 * Do not change tariff rules here; this only maps transport outcomes to `paidCalls`.
 */
export type PaidHttpClass = "likely_billable" | "non_billable" | "unknown";

export function classifyPaidHttpOutcome(outcome: {
  httpReached: boolean;
  networkFailed?: boolean;
}): PaidHttpClass {
  if (outcome.httpReached) {
    return "likely_billable";
  }
  if (outcome.networkFailed) {
    return "non_billable";
  }
  return "unknown";
}

export function paidCallsForHttpClass(classification: PaidHttpClass) {
  return classification === "likely_billable" ? 1 : 0;
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
    value: Math.max(0, paidCalls),
    enumerable: true,
    configurable: true,
  });
  return error as T & { paidCalls: number };
}
