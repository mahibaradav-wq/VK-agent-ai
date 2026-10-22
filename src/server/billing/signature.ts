import { createHmac, timingSafeEqual } from "node:crypto";

import { AccessError } from "@/modules/access/permissions";

const MAX_SKEW_SECONDS = 300;

export function createBillingSignature(secret: string, timestamp: number, rawBody: string) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

export function verifyBillingSignature(secret: string, header: string, rawBody: string, nowMs = Date.now()) {
  const parts: Record<string, string> = {};
  for (const piece of header.split(",")) {
    const separator = piece.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    parts[piece.slice(0, separator).trim()] = piece.slice(separator + 1).trim();
  }
  const timestamp = Number(parts.t);
  const provided = parts.v1 ?? "";
  if (!Number.isFinite(timestamp) || Math.abs(nowMs / 1000 - timestamp) > MAX_SKEW_SECONDS) {
    throw new AccessError(400, "Подпись webhook просрочена или повреждена.");
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");
  if (
    expectedBuffer.length === 0 ||
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new AccessError(400, "Подпись webhook недействительна.");
  }
}
