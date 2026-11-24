import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("isolated VPS backup and restore operations", () => {
  it(
    "passes the probe-mode backup, restore, and failure suite",
    () => {
      const result = spawnSync("bash", ["scripts/tests/vps-ops.test.sh"], {
        encoding: "utf8",
        timeout: 120_000,
      });
      if (result.status !== 0) {
        throw new Error(
          [result.stdout, result.stderr].filter(Boolean).join("\n") || `vps-ops exited ${result.status}`,
        );
      }
      expect(result.stdout).toMatch(/vps-ops tests: \d+ passed/);
    },
    120_000,
  );
});
