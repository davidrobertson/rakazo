export const SEEN_RUN_ERROR_LIMIT = 100;
const SEEN_RUN_ERROR_STORAGE_KEY = "rakazo:seen-run-error-ids";

type RunErrorStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): RunErrorStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSeenRunErrorIds(
  storage: Pick<RunErrorStorage, "getItem"> | null = browserStorage(),
): Set<string> {
  if (!storage) return new Set();
  try {
    const value: unknown = JSON.parse(storage.getItem(SEEN_RUN_ERROR_STORAGE_KEY) ?? "[]");
    return new Set(
      (Array.isArray(value) ? value : [])
        .filter((id): id is string => typeof id === "string")
        .slice(-SEEN_RUN_ERROR_LIMIT),
    );
  } catch {
    return new Set();
  }
}

export function rememberSeenRunErrorId(
  id: string,
  storage: RunErrorStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    const ids = [...readSeenRunErrorIds(storage)].filter((candidate) => candidate !== id);
    storage.setItem(
      SEEN_RUN_ERROR_STORAGE_KEY,
      JSON.stringify([...ids, id].slice(-SEEN_RUN_ERROR_LIMIT)),
    );
  } catch {
    // Keep the current-session error behavior when storage is unavailable.
  }
}
