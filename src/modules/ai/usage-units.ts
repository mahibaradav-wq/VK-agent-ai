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
 * - **likely_billable**: provider returned an HTTP response (any status) → 1 unit.
 * - **non_billable**: proven the request was never sent (DNS / connect refused before send) → 0.
 * - **unknown**: fetch failed without proof it never left the client (timeout, abort, disconnect,
 *   generic TypeError) → **1 unit** (conservative: do not undercount).
 * Do not change tariff rules here; this only maps transport outcomes to `paidCalls`.
 */
export type PaidHttpClass = "likely_billable" | "non_billable" | "unknown";

/** System / undici codes that mean TCP/TLS never connected (request body not sent). */
const NEVER_SENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ERR_NAME_NOT_RESOLVED",
  "ENOTCONNECTED",
]);

export function classifyPaidHttpOutcome(outcome: {
  httpReached?: boolean;
  /** True only when proven the outbound request was never transmitted. */
  requestNeverSent?: boolean;
}): PaidHttpClass {
  if (outcome.httpReached) {
    return "likely_billable";
  }
  if (outcome.requestNeverSent) {
    return "non_billable";
  }
  return "unknown";
}

/** Conservative: only proven pre-send refusal is free; unknown counts as billed. */
export function paidCallsForHttpClass(classification: PaidHttpClass) {
  return classification === "non_billable" ? 0 : 1;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string" && direct) {
    return direct;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const nested = (cause as { code?: unknown }).code;
    if (typeof nested === "string" && nested) {
      return nested;
    }
  }
  return "";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    return typeof value === "string" ? value : "";
  }
  return String(error ?? "");
}

/**
 * Classify a fetch() rejection. Prefer charging 1 unless the failure proves
 * the HTTP request was never sent (DNS / connection refused before connect).
 */
export function classifyFetchFailure(error: unknown): PaidHttpClass {
  const code = errorCode(error);
  if (code && NEVER_SENT_CODES.has(code)) {
    return classifyPaidHttpOutcome({ requestNeverSent: true });
  }
  const message = errorMessage(error).toLowerCase();
  // Browser / undici phrasing for DNS before connect — still treat as never-sent only for clear DNS.
  if (
    message.includes("getaddrinfo") ||
    message.includes("err_name_not_resolved") ||
    (message.includes("enotfound") && message.includes("fetch"))
  ) {
    return classifyPaidHttpOutcome({ requestNeverSent: true });
  }
  // Timeout / abort / reset / generic fetch failed → unknown → bill 1.
  return classifyPaidHttpOutcome({});
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
