import type { ConnectorTool } from "@rakazo/adapter-kit";
import { approvalEffectKey } from "@rakazo/core/node/approval-effect-key";
import { describe, expect, it } from "vitest";
import {
  approvedCatalogReplay,
  approvedReplayArgs,
  catalogApprovalRequest,
  createApprovedEffectReplayQueue,
} from "./approval-effect.js";
import { APPROVED_EFFECT_REPLAY_ORDER, buildApprovalContinuation } from "./executor.js";
import {
  catalogEntries,
  disambiguateInstalledToolNames,
  resolveCatalogCall,
} from "./lazy-tool-catalog.js";

describe("executor approval replay", () => {
  it.each([
    ["MCP", "install-mcp", "notes.write"],
    ["API", "install-api", "createContact"],
  ])("replays a pre-namespaced installed %s approval", (_kind, resourceId, toolName) => {
    const [tool] = disambiguateInstalledToolNames([
      {
        name: toolName,
        description: toolName,
        inputSchema: { type: "object" },
        route: { connectorId: "installed", resourceId, toolName },
      },
    ]);
    const request = catalogApprovalRequest(
      { id: `${resourceId}:${toolName}`, arguments: {} },
      "installed_execute_tool",
      "__rakazoCatalogTool",
    );
    const queue = createApprovedEffectReplayQueue([{ kind: toolName, request }]);

    expect(tool!.name).toBe(toolName);
    expect(queue.take(tool!.name)).toEqual(request);
    expect(queue.assertDrained).not.toThrow();
  });

  it("lists and replays every approved request in FIFO order when a tool repeats", () => {
    const effects = [
      { kind: "destination.write", request: { sequence: 1 } },
      { kind: "destination.write", request: { sequence: 2 } },
    ];

    const continuation = buildApprovalContinuation(effects, JSON.stringify);
    expect(continuation).toContain(
      "Call each listed approved request exactly once, in the listed order",
    );
    expect(continuation?.indexOf('{"sequence":1}')).toBeLessThan(
      continuation?.indexOf('{"sequence":2}') ?? -1,
    );

    const queue = createApprovedEffectReplayQueue(effects);
    expect(queue.take("destination.write")).toEqual({ sequence: 1 });
    expect(queue.assertDrained).toThrow("Approved tool requests were not fully replayed");
    expect(queue.take("destination.write")).toEqual({ sequence: 2 });
    expect(queue.take("destination.write")).toBeUndefined();
    expect(queue.assertDrained).not.toThrow();
  });

  it("uses a stable secondary key when approval timestamps match", () => {
    expect(APPROVED_EFFECT_REPLAY_ORDER).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("replays an approved lazy tool through the exposed catalog executor", () => {
    const continuation = buildApprovalContinuation(
      [
        {
          kind: "mcp__demo__send_message",
          request: catalogApprovalRequest(
            { id: "server-1:send_message", arguments: { text: "approved exactly" } },
            "mcp_execute_tool",
            "__rakazoCatalogTool",
          ),
        },
      ],
      JSON.stringify,
    );

    expect(continuation).toContain(
      'mcp_execute_tool: {"id":"server-1:send_message","arguments":{"text":"approved exactly"}}',
    );
    expect(continuation).not.toContain("__rakazoCatalogTool");
    expect(continuation).not.toContain("__rakazoCatalogApproval");
  });

  it("keeps a direct-tool argument named like the catalog marker in continuation JSON", () => {
    const continuation = buildApprovalContinuation(
      [
        {
          kind: "notes.write",
          request: {
            text: "approved exactly",
            __rakazoCatalogTool: "not-a-wrapper",
          },
        },
      ],
      JSON.stringify,
    );

    expect(continuation).toContain(
      'notes.write: {"text":"approved exactly","__rakazoCatalogTool":"not-a-wrapper"}',
    );
  });

  it("keeps a catalog-shaped direct tool under its own kind in continuation JSON", () => {
    const continuation = buildApprovalContinuation(
      [
        {
          kind: "notes.write",
          request: {
            id: "row-1",
            arguments: { mode: "strict" },
            __rakazoCatalogTool: "installed_execute_tool",
          },
        },
      ],
      JSON.stringify,
    );

    expect(continuation).toContain("notes.write:");
    expect(continuation).not.toMatch(/^installed_execute_tool:/m);
    expect(continuation).toContain('"__rakazoCatalogTool":"installed_execute_tool"');
  });

  it("pins lazy approval replay to the approved source when tool names collide", () => {
    const effects = [
      {
        kind: "delete_item",
        request: catalogApprovalRequest(
          { id: "install-A:delete_item", arguments: { target: "approved" } },
          "installed_execute_tool",
          "__rakazoCatalogTool",
        ),
      },
    ];
    const queue = createApprovedEffectReplayQueue(effects);
    const replay = approvedCatalogReplay(queue, "installed_execute_tool", "__rakazoCatalogTool");
    const modelRuntimeArgs = {
      id: "install-B:delete_item",
      arguments: { target: "model-reconstructed" },
    };
    const tools: ConnectorTool[] = ["install-A", "install-B"].map((resourceId) => ({
      name: "delete_item",
      description: "Delete one item",
      inputSchema: {
        type: "object",
        properties: { target: { type: "string" } },
        required: ["target"],
      },
      route: { connectorId: "installed", resourceId, toolName: "delete_item" },
    }));

    const resolved = resolveCatalogCall(
      {
        tool: "installed_execute_tool",
        args: replay.args ?? modelRuntimeArgs,
        executionId: "approved",
        route: { connectorId: "installed", toolName: "__catalog_execute" },
      },
      catalogEntries(tools),
    );

    expect(resolved.call.route?.resourceId).toBe("install-A");
    expect(resolved.call.args).toEqual({ target: "approved" });
  });

  it("keeps resolveCall parsed args when draining an approved catalog replay", () => {
    const marker = "__rakazoCatalogTool";
    const approvedRequest = catalogApprovalRequest(
      { id: "install-A:create_item", arguments: {} },
      "installed_execute_tool",
      marker,
    );
    const queue = createApprovedEffectReplayQueue([
      { kind: "create_item", request: approvedRequest },
    ]);
    const replay = approvedCatalogReplay(queue, "installed_execute_tool", marker);
    const tool: ConnectorTool = {
      name: "create_item",
      description: "Create one item",
      inputSchema: {
        type: "object",
        properties: { count: { type: "integer", default: 3 } },
        additionalProperties: false,
      },
      route: { connectorId: "installed", resourceId: "install-A", toolName: "create_item" },
    };
    const resolved = resolveCatalogCall(
      {
        tool: "installed_execute_tool",
        args: replay.args!,
        executionId: "approved",
        route: { connectorId: "installed", toolName: "__catalog_execute" },
      },
      catalogEntries([tool]),
    );
    const replayed = approvedReplayArgs(queue.take(tool.name)!, resolved.call.args, marker, true);

    expect(resolved.call.args).toEqual({ count: 3 });
    expect(replayed).toEqual({ count: 3 });
    expect(replayed).not.toEqual(approvedRequest.arguments);
    expect(approvalEffectKey("run", tool.name, replayed)).toBe(
      approvalEffectKey("run", tool.name, resolved.call.args),
    );
    expect(queue.assertDrained).not.toThrow();
  });
});
