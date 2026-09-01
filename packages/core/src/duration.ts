/** Formats a persisted elapsed duration with whole seconds and locale-aware units. */
export function formatDurationMs(
  durationMs: number | undefined,
  locale = "en",
  unitDisplay: "short" | "long" = "short",
): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return null;
  const totalSeconds = Math.round(Math.max(0, durationMs) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (locale.startsWith("en") && unitDisplay === "short") {
    return [hours ? `${hours}h` : "", minutes || hours ? `${minutes}m` : "", `${seconds}s`]
      .filter(Boolean)
      .join(" ");
  }
  try {
    const format = (value: number, unit: "hour" | "minute" | "second") =>
      new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay }).format(value);
    return [
      hours ? format(hours, "hour") : "",
      minutes || hours ? format(minutes, "minute") : "",
      format(seconds, "second"),
    ]
      .filter(Boolean)
      .join(" ");
  } catch {
    if (unitDisplay === "short") {
      return [hours ? `${hours}h` : "", minutes || hours ? `${minutes}m` : "", `${seconds}s`]
        .filter(Boolean)
        .join(" ");
    }
    return [
      hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "",
      minutes || hours ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "",
      `${seconds} ${seconds === 1 ? "second" : "seconds"}`,
    ]
      .filter(Boolean)
      .join(" ");
  }
}
