import { describe, expect, it } from "vitest";
import { formatDurationMs } from "./duration.js";

describe("formatDurationMs", () => {
  it.each([
    [0, "0s"],
    [8_000, "8s"],
    [103_000, "1m 43s"],
    [3_723_000, "1h 2m 3s"],
  ])("formats %i milliseconds as whole units", (durationMs, expected) => {
    expect(formatDurationMs(durationMs)).toBe(expected);
  });

  it("clamps negative durations and rejects non-finite values", () => {
    expect(formatDurationMs(-1)).toBe("0s");
    expect(formatDurationMs(Number.NaN)).toBeNull();
    expect(formatDurationMs(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatDurationMs(undefined)).toBeNull();
  });
});
