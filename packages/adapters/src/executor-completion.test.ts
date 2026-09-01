import { describe, expect, it } from "vitest";
import {
  completedActivityBlocks,
  completedActivityBlocksForAttempts,
  completionMarksUnread,
  completionMessageSegments,
  completionNotificationBody,
  subagentMarksUnread,
  workedDurationMs,
} from "./executor.js";

describe("completedActivityBlocks", () => {
  it("stamps the turn duration on only the final steps block", () => {
    expect(
      completedActivityBlocks(
        [
          { kind: "steps", steps: [{ label: "Read file", count: 1 }] },
          { kind: "text", text: "Checked it. " },
          { kind: "steps", steps: [{ label: "Shell", count: 1 }] },
          { kind: "text", text: "Done." },
        ],
        103_000,
      ),
    ).toEqual([
      { kind: "steps", steps: [{ label: "Read file", count: 1 }] },
      { kind: "text", text: "Checked it. " },
      { kind: "steps", steps: [{ label: "Shell", count: 1 }], durationMs: 103_000 },
      { kind: "text", text: "Done." },
    ]);
  });

  it("clamps a clock reversal and leaves tool-free completions unchanged", () => {
    expect(
      completedActivityBlocks([{ kind: "steps", steps: [{ label: "Shell", count: 1 }] }], -1_000),
    ).toEqual([{ kind: "steps", steps: [{ label: "Shell", count: 1 }], durationMs: 0 }]);
    expect(completedActivityBlocks([{ kind: "text", text: "Done." }], 1_000)).toEqual([
      { kind: "text", text: "Done." },
    ]);
  });
});

describe("completedActivityBlocksForAttempts", () => {
  it("stamps early-completion activity from persisted active attempts", async () => {
    await expect(
      completedActivityBlocksForAttempts(
        [{ kind: "steps", steps: [{ label: "Shell", count: 6 }] }],
        "current",
        105_000,
        async () => [
          { id: "first", startedAt: new Date(1_000), finishedAt: new Date(11_000) },
          { id: "current", startedAt: new Date(100_000), finishedAt: null },
        ],
      ),
    ).resolves.toEqual([
      { kind: "steps", steps: [{ label: "Shell", count: 6 }], durationMs: 15_000 },
    ]);
  });
});

describe("workedDurationMs", () => {
  it("sums active attempts without counting queue or user-wait gaps", () => {
    expect(
      workedDurationMs(
        [
          {
            id: "first",
            startedAt: new Date(1_000),
            finishedAt: new Date(11_000),
          },
          {
            id: "interrupted-without-finish",
            startedAt: new Date(20_000),
            finishedAt: null,
          },
          {
            id: "current",
            startedAt: new Date(100_000),
            finishedAt: null,
          },
        ],
        "current",
        105_000,
      ),
    ).toBe(15_000);
  });

  it("clamps reversed attempt clocks safely", () => {
    expect(
      workedDurationMs(
        [
          {
            id: "current",
            startedAt: new Date(2_000),
            finishedAt: null,
          },
        ],
        "current",
        1_000,
      ),
    ).toBe(0);
  });
});

describe("completionMessageSegments", () => {
  it("keeps visible tool activity without appending a generic completion claim", () => {
    const steps = [{ kind: "steps" as const, steps: [{ label: "Message bot", count: 1 }] }];
    expect(completionMessageSegments(steps)).toEqual(steps);
  });

  it("keeps the last-resort fallback for a runtime that produced nothing", () => {
    expect(completionMessageSegments([])).toEqual([{ kind: "text", text: "done." }]);
  });

  it("allows a fully empty completion for silent bot-message wakes", () => {
    expect(completionMessageSegments([], { allowSilentEmpty: true })).toEqual([]);
  });

  it("drops narration after a successful group handoff", () => {
    expect(
      completionMessageSegments([{ kind: "text", text: "Research is checking this." }], {
        suppressOutput: true,
      }),
    ).toEqual([]);
  });

  it("uses a contextual fallback for a non-silent peer result", () => {
    expect(
      completionMessageSegments([], { emptyResponseText: "Update from Researcher: 42" }),
    ).toEqual([{ kind: "text", text: "Update from Researcher: 42" }]);
  });

  it("keeps a peer result visible when the runtime emitted only tool activity", () => {
    const steps = [{ kind: "steps" as const, steps: [{ label: "Read file", count: 1 }] }];
    expect(
      completionMessageSegments(steps, { emptyResponseText: "Update from Researcher: 42" }),
    ).toEqual([...steps, { kind: "text", text: "Update from Researcher: 42" }]);
  });

  it("does not append fallback text to a tool-only FYI", () => {
    const steps = [{ kind: "steps" as const, steps: [{ label: "Read file", count: 1 }] }];
    expect(
      completionMessageSegments(steps, {
        allowSilentEmpty: true,
        emptyResponseText: "synthetic text",
      }),
    ).toEqual(steps);
  });

  it("normalizes a blank fallback", () => {
    expect(completionMessageSegments([], { emptyResponseText: "   " })).toEqual([
      { kind: "text", text: "done." },
    ]);
  });
});

describe("completionNotificationBody", () => {
  it("omits a body when only tool or step activity remains", () => {
    const steps = completionMessageSegments([
      { kind: "steps" as const, steps: [{ label: "Message bot", count: 1 }] },
    ]);
    expect(completionNotificationBody("", steps)).toBe("");
  });

  it("uses the empty-run text when that is all the run produced", () => {
    expect(completionNotificationBody("", completionMessageSegments([]))).toBe("done.");
  });
});

describe("completionMarksUnread", () => {
  it("ignores silent routine activity but keeps routine comments and manual replies unread", () => {
    expect(completionMarksUnread("routine", "")).toBe(false);
    expect(completionMarksUnread("routine", "Daily report ready")).toBe(true);
    expect(completionMarksUnread("user", "")).toBe(true);
  });

  it("keeps empty-run done. fallback unread and notifying", () => {
    const segments = completionMessageSegments([]);
    const text = completionNotificationBody("", segments);
    expect(segments).toEqual([{ kind: "text", text: "done." }]);
    expect(text).toBe("done.");
    expect(completionMarksUnread("routine", text)).toBe(true);
    expect(completionMarksUnread("user", text)).toBe(true);
  });

  it("does not invent done. unread for a routine whose only activity is a completed subagent", () => {
    // Terminal subagent rows are published separately; skipEmptyFallback mirrors that durable
    // activity so completion does not synthesize "done." (which would mark unread + notify).
    const segments = completionMessageSegments([], { skipEmptyFallback: true });
    const text = completionNotificationBody("", segments);
    expect(segments).toEqual([]);
    expect(text).toBe("");
    expect(completionMarksUnread("routine", text)).toBe(false);
    expect(completionMarksUnread("user", text)).toBe(true);
  });
});

describe("subagentMarksUnread", () => {
  it("ignores completed routine activity but preserves failures and manual activity", () => {
    expect(subagentMarksUnread("routine", "completed")).toBe(false);
    expect(subagentMarksUnread("routine", "failed")).toBe(true);
    expect(subagentMarksUnread("user", "completed")).toBe(true);
  });
});
