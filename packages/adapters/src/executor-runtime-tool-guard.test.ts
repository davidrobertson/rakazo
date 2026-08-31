import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
  ConnectorProvider,
  MemoryStore,
} from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunExecutor } from "./executor.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { LocalAgentHomeStore } from "./home.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function defectiveRuntime(options: {
  scripted: boolean;
  toolName: "recall_memory" | "save_memory";
  results: unknown[];
}): AgentRuntime {
  return {
    describe: () => ({
      id: options.scripted ? "defective-scripted" : "defective-callback",
      contractVersion: "1",
      adapterVersion: "test",
      capabilities: {
        streaming: true,
        compaction: false,
        tools: true,
        scripted: options.scripted,
      },
    }),
    abort: vi.fn(async () => undefined),
    async *run(request: AgentRunRequest): AsyncIterable<AgentRuntimeEvent> {
      const args =
        options.toolName === "recall_memory" ? { query: "launch" } : { content: "launch" };
      const executionId = `run-1:${options.toolName}:0`;
      if (options.scripted) {
        yield { type: "tool", name: options.toolName, args, executionId };
      } else {
        options.results.push(await request.executeTool!(options.toolName, args, executionId));
      }
      yield { type: "done", text: "done" };
    },
  };
}

async function executorFixture(runtime: AgentRuntime) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "rakazo-runtime-tool-guard-"));
  temporaryDirectories.push(dataDir);
  const run = {
    id: "run-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    status: "queued",
    trigger: "user",
    routineId: null,
    sourceMessageId: null,
    checkpoint: null,
    leaseFence: 0,
  };
  const computer = {
    id: "computer-1",
    homeKey: "bot-1",
    providerRef: "computer-1",
    kind: "fake",
    scope: "dedicated",
    state: "running",
    controlLeaseId: null,
    controlLeaseExpiresAt: null,
  };
  const bot = {
    id: "bot-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    name: "Guard Bot",
    title: "Tester",
    description: "Tests runtime boundaries",
    instructions: "Follow the request.",
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    memoryScope: null,
    computer,
  };
  const thread = {
    id: "thread-1",
    groupId: null,
    historyCompactionSummary: null,
    historyCompactedUpToSeq: null,
    historyCompactionGeneration: 0,
    nextMessageSeq: 1,
  };
  const runUpdateMany = vi.fn(async () => ({ count: 1 }));
  const approvalRuleFindMany = vi.fn(async () => []);
  const autoReviewFindUnique = vi.fn(async () => null);
  const effectFindUnique = vi.fn(async () => null);
  const effectCreate = vi.fn();
  const effectUpdate = vi.fn();
  const effectUpdateMany = vi.fn();
  const prisma = {
    run: {
      findUnique: vi.fn(async (args: { select?: unknown }) =>
        args.select ? { status: "running", leaseOwner: "worker-1", leaseFence: 1 } : run,
      ),
      findUniqueOrThrow: vi.fn(async () => ({ ...run, status: "leased", startedAt: null })),
      updateMany: runUpdateMany,
    },
    bot: {
      findUniqueOrThrow: vi.fn(async (args: { include?: unknown }) =>
        args.include ? bot : { computerId: computer.id, computerSwitching: false },
      ),
      findMany: vi.fn(async () => []),
    },
    computer: {
      findUniqueOrThrow: vi.fn(async () => computer),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => computer),
    },
    attempt: {
      create: vi.fn(async () => ({ id: "attempt-1" })),
      update: vi.fn(async () => ({ id: "attempt-1" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    thread: { findUniqueOrThrow: vi.fn(async () => thread) },
    message: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
    task: { findUniqueOrThrow: vi.fn(async () => ({ id: "task-1", prompt: "test" })) },
    connection: { findMany: vi.fn(async () => []) },
    userModelCredential: { findFirst: vi.fn(async () => null) },
    deploymentSettings: { findUnique: vi.fn(async () => null) },
    organization: { findUniqueOrThrow: vi.fn(async () => ({ teamInstructions: "" })) },
    taughtSkill: { findMany: vi.fn(async () => []) },
    agentSkill: { findMany: vi.fn(async () => []) },
    scratchpadItem: { findMany: vi.fn(async () => []) },
    externalEffect: {
      findMany: vi.fn(async () => []),
      findUnique: effectFindUnique,
      create: effectCreate,
      update: effectUpdate,
      updateMany: effectUpdateMany,
    },
    actionApprovalRule: { findMany: approvalRuleFindMany },
    actionAutoReviewPreference: { findUnique: autoReviewFindUnique },
  } as unknown as PrismaClient;
  const finalizeRun = vi.fn(async () => true);
  const events = {
    append: vi.fn(async () => undefined),
    notify: vi.fn(async () => undefined),
    finalizeRun,
  };
  const memoryCommit = vi.fn();
  const memory = {
    read: vi.fn(async () => ({ documents: [] })),
    commit: memoryCommit,
  } as unknown as MemoryStore;
  const connectorExecute = vi.fn(async function* () {
    yield { type: "error" as const, message: "must not execute" };
  });
  const connector = {
    discoverTools: vi.fn(async () => []),
    execute: connectorExecute,
  } as unknown as ConnectorProvider;
  const executor = createRunExecutor({
    prisma,
    runtime,
    sandbox: new FakeSandboxProvider(),
    home: new LocalAgentHomeStore(dataDir),
    memory,
    memoryProviders: { resolve: vi.fn(async () => null) },
    connector,
    events: events as never,
    jobs: {
      enqueue: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    },
    secrets: [],
    secretStore: {} as never,
    dataDir,
  });

  return {
    executor,
    finalizeRun,
    memoryCommit,
    connectorExecute,
    approvalRuleFindMany,
    autoReviewFindUnique,
    effectFindUnique,
    effectCreate,
    effectUpdate,
    effectUpdateMany,
  };
}

function expectNoDispatchSideEffects(fixture: Awaited<ReturnType<typeof executorFixture>>): void {
  expect(fixture.memoryCommit).not.toHaveBeenCalled();
  expect(fixture.connectorExecute).not.toHaveBeenCalled();
  expect(fixture.approvalRuleFindMany).not.toHaveBeenCalled();
  expect(fixture.autoReviewFindUnique).not.toHaveBeenCalled();
  expect(fixture.effectFindUnique).not.toHaveBeenCalled();
  expect(fixture.effectCreate).not.toHaveBeenCalled();
  expect(fixture.effectUpdate).not.toHaveBeenCalled();
  expect(fixture.effectUpdateMany).not.toHaveBeenCalled();
}

describe("createRunExecutor runtime tool allowlist", () => {
  it.each(["recall_memory", "save_memory"] as const)(
    "contains a defective scripted %s event at the executor boundary",
    async (toolName) => {
      const runtimeResults: unknown[] = [];
      const fixture = await executorFixture(
        defectiveRuntime({ scripted: true, toolName, results: runtimeResults }),
      );

      await fixture.executor.continueRun("run-1", "worker-1");

      expect(runtimeResults).toEqual([]);
      expect(fixture.finalizeRun).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "completed" }),
      );
      expectNoDispatchSideEffects(fixture);
    },
  );

  it.each(["recall_memory", "save_memory"] as const)(
    "returns a structured error when a defective non-scripted runtime invokes %s",
    async (toolName) => {
      const runtimeResults: unknown[] = [];
      const fixture = await executorFixture(
        defectiveRuntime({ scripted: false, toolName, results: runtimeResults }),
      );

      await fixture.executor.continueRun("run-1", "worker-1");

      expect(runtimeResults).toEqual([
        { error: `Tool "${toolName}" is not available for this run.` },
      ]);
      expect(fixture.finalizeRun).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "completed" }),
      );
      expectNoDispatchSideEffects(fixture);
    },
  );
});
