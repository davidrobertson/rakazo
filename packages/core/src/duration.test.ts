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

  it("falls back to deterministic English units for an invalid locale", () => {
    expect(formatDurationMs(103_000, "bad_locale")).toBe("1m 43s");
    expect(formatDurationMs(103_000, "bad_locale", "long")).toBe("1 minute 43 seconds");
  });

  it.each([
    ["de", "1 Std. 2 Min. 3 Sek.", "1 Stunde 2 Minuten 3 Sekunden"],
    ["hi", "1 घं॰ 2 मि॰ 3 से॰", "1 घंटा 2 मिनट 3 सेकंड"],
    ["ko", "1시간 2분 3초", "1시간 2분 3초"],
    ["pt-BR", "1 h 2 min 3 s", "1 hora 2 minutos 3 segundos"],
    ["tr", "1 sa. 2 dk. 3 sn.", "1 saat 2 dakika 3 saniye"],
  ])("localizes compact and spoken duration units for %s", (locale, compact, spoken) => {
    expect(formatDurationMs(3_723_000, locale)).toBe(compact);
    expect(formatDurationMs(3_723_000, locale, "long")).toBe(spoken);
  });
});
