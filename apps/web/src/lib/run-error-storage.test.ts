import type { ThreadSnapshot } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  readSeenRunErrorIds,
  rememberSeenRunErrorId,
  SEEN_RUN_ERROR_LIMIT,
} from "./run-error-storage";
import { threadRunError } from "./thread-events";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function failedSnapshot(id: string): ThreadSnapshot {
  return {
    botId: "bot-1",
    threadId: "thread-1",
    cursor: 1,
    messages: [],
    olderCursor: null,
    run: {
      id,
      botId: "bot-1",
      threadId: "thread-1",
      taskId: "task-1",
      status: "failed",
      trigger: "user",
      routineId: null,
      modelProvider: null,
      modelId: null,
      error: "connection refused",
      startedAt: null,
      completedAt: null,
      createdAt: "2026-08-31T00:00:00.000Z",
    },
  };
}

describe("seen run error storage", () => {
  it("keeps the shell usable when browser storage access is blocked", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    try {
      expect(() => readSeenRunErrorIds()).not.toThrow();
      expect(() => rememberSeenRunErrorId("run-1")).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("shows a new failure once, then suppresses the same stored failure after reload", () => {
    const localStorage = storage();
    const failed = failedSnapshot("run-old");

    const firstLoad = readSeenRunErrorIds(localStorage);
    expect(threadRunError(failed, firstLoad)).toBe("connection refused");

    rememberSeenRunErrorId("run-old", localStorage);
    expect(threadRunError(failed, firstLoad)).toBe("connection refused");

    const reloaded = readSeenRunErrorIds(localStorage);
    expect(threadRunError(failed, reloaded)).toBeNull();
    expect(threadRunError(failedSnapshot("run-new"), reloaded)).toBe("connection refused");
  });

  it("bounds persisted failures to the newest IDs", () => {
    const localStorage = storage();
    for (let index = 0; index <= SEEN_RUN_ERROR_LIMIT; index += 1) {
      rememberSeenRunErrorId(`run-${index}`, localStorage);
    }

    const reloaded = readSeenRunErrorIds(localStorage);
    expect(reloaded).toHaveLength(SEEN_RUN_ERROR_LIMIT);
    expect(reloaded.has("run-0")).toBe(false);
    expect(reloaded.has(`run-${SEEN_RUN_ERROR_LIMIT}`)).toBe(true);
  });
});
