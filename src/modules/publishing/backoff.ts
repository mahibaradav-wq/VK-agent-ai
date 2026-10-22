export const defaultBackoffMs = [30_000, 120_000, 480_000, 1_920_000];

export function nextBackoffMs(attemptCount: number, table: number[] = defaultBackoffMs) {
  if (attemptCount <= 0 || table.length === 0) {
    return 0;
  }
  return table[Math.min(attemptCount - 1, table.length - 1)] ?? 0;
}
