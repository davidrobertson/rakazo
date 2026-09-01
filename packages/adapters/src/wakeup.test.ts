import type { BackgroundJobHandlers } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryJobQueue } from "./wakeup.js";

function handlers(): BackgroundJobHandlers {
  return {
    "run.continue": vi.fn(async () => undefined),
    "routine.wakeup": vi.fn(async () => undefined),
    "computer.sleep": vi.fn(async () => undefined),
    "computer.control-expire": vi.fn(async () => undefined),
    "skill.teaching-expire": vi.fn(async () => undefined),
    "history.compact": vi.fn(async () => undefined),
    "messaging.deliver": vi.fn(async () => undefined),
  };
}

describe("InMemoryJobQueue", () => {
  afterEach(() => vi.useRealTimers());

  it("delivers delayed jobs", async () => {
    vi.useFakeTimers();
    const queue = new InMemoryJobQueue();
    const target = handlers();
    await queue.start(target);
    await queue.enqueue({
      name: "run.continue",
      payload: { runId: "run-1" },
      availableAt: new Date(Date.now() + 1_000),
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(target["run.continue"]).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(target["run.continue"]).toHaveBeenCalledWith({ runId: "run-1" });
    await queue.close();
  });

  it("replaces and cancels keyed jobs", async () => {
    vi.useFakeTimers();
    const queue = new InMemoryJobQueue();
    const target = handlers();
    await queue.start(target);
    await queue.enqueue({
      name: "computer.sleep",
      payload: { computerId: "old" },
      availableAt: new Date(Date.now() + 1_000),
      replaceKey: "computer.sleep:1",
    });
    await queue.enqueue({
      name: "computer.sleep",
      payload: { computerId: "new" },
      availableAt: new Date(Date.now() + 1_000),
      replaceKey: "computer.sleep:1",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(target["computer.sleep"]).toHaveBeenCalledTimes(1);
    expect(target["computer.sleep"]).toHaveBeenCalledWith({ computerId: "new" });

    await queue.enqueue({
      name: "computer.sleep",
      payload: { computerId: "cancelled" },
      availableAt: new Date(Date.now() + 1_000),
      replaceKey: "computer.sleep:2",
    });
    await queue.cancel("computer.sleep:2");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(target["computer.sleep"]).toHaveBeenCalledTimes(1);
    await queue.close();
  });

  it("waits for an active handler before closing", async () => {
    const queue = new InMemoryJobQueue();
    let releaseHandler: () => void = () => undefined;
    let markStarted: () => void = () => undefined;
    let nestedEnqueueFailed = false;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const target = handlers();
    target["run.continue"] = vi.fn(async () => {
      markStarted();
      await new Promise<void>((resolve) => {
        releaseHandler = resolve;
      });
      try {
        await queue.enqueue({ name: "computer.sleep", payload: { computerId: "computer-1" } });
      } catch {
        nestedEnqueueFailed = true;
      }
    });
    await queue.start(target);
    await queue.enqueue({ name: "run.continue", payload: { runId: "run-1" } });
    await started;

    const closing = queue.close();
    const closeState = await Promise.race([
      closing.then(() => "closed" as const),
      new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 5)),
    ]);
    releaseHandler();
    await closing;
    expect(closeState).toBe("waiting");
    expect(nestedEnqueueFailed).toBe(false);
  });
});
