import type { ConnectorTool } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import {
  catalogEntries,
  DIRECT_TOOL_LIMIT,
  disambiguateInstalledToolNames,
  lazyCatalogTools,
  loadCatalogEntry,
  resolveCatalogCall,
  SELECTED_SCHEMA_MAX_BYTES,
  searchCatalog,
  TOOL_SEARCH_LIMIT,
  uniquifyInstalledToolName,
} from "./lazy-tool-catalog.js";

function tools(count: number): ConnectorTool[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `tool_${String(index).padStart(2, "0")}`,
    description: "Shared catalog result",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
    route: { connectorId: "test", resourceId: `source-${index}`, toolName: `tool-${index}` },
  }));
}

describe("lazy tool catalog", () => {
  it("exposes tools directly at the limit and switches to lazy wrappers above it", () => {
    expect(tools(DIRECT_TOOL_LIMIT)).toHaveLength(20);
    expect(tools(DIRECT_TOOL_LIMIT + 1)).toHaveLength(21);
    expect(lazyCatalogTools("mcp", "mcp", "MCP")).toHaveLength(3);
    expect(
      lazyCatalogTools("installed", "installed", "API").map((tool) => tool.description),
    ).toEqual([
      "Search connected API tools.",
      "Load one API tool's parameters by id.",
      "Run an API tool by id.",
    ]);
    expect(lazyCatalogTools("mcp", "mcp", "MCP").map((tool) => tool.description)).toEqual([
      "Search connected MCP tools.",
      "Load one MCP tool's parameters by id.",
      "Run an MCP tool by id.",
    ]);
  });

  it("returns an empty catalog as an empty tool list", () => {
    expect(catalogEntries([])).toEqual([]);
    expect(searchCatalog([], { query: "anything" })).toEqual([]);
  });

  it("caps and stably orders schema-free search results", () => {
    const catalog = tools(25);
    const first = searchCatalog(catalogEntries(catalog), { query: "shared", limit: 100 });
    const second = searchCatalog(catalogEntries(catalog), { query: "shared", limit: 100 });

    expect(first).toHaveLength(TOOL_SEARCH_LIMIT);
    expect(first).toEqual(second);
    expect(first.map((item) => item.name)).toEqual(
      [...first.map((item) => item.name)].sort((left, right) => left.localeCompare(right)),
    );
    expect(JSON.stringify(first)).not.toContain("secretShape");
  });

  it("rejects an untrusted selected schema above the byte ceiling", () => {
    const entries = catalogEntries([
      {
        name: "oversized",
        description: "Oversized schema",
        inputSchema: { type: "object", description: "x".repeat(SELECTED_SCHEMA_MAX_BYTES) },
      },
    ]);

    expect(() => loadCatalogEntry(entries, { id: "oversized" })).toThrow("schema is too large");
  });

  it("caps load descriptions like search", () => {
    const long = "d".repeat(600);
    const entries = catalogEntries([
      {
        name: "verbose",
        description: long,
        inputSchema: { type: "object", properties: {} },
        route: { connectorId: "test", resourceId: "src", toolName: "verbose" },
      },
    ]);
    const entry = loadCatalogEntry(entries, { id: "src:verbose" });
    expect(entry.tool.description).toHaveLength(600);
    expect(searchCatalog(entries, { query: "verbose" })[0]?.description).toHaveLength(500);
  });

  it("passes through args when JSON Schema is unsupported", () => {
    const entries = catalogEntries([
      {
        name: "exotic",
        description: "Unsupported schema",
        // unevaluatedProperties is rejected by z.fromJSONSchema
        inputSchema: {
          type: "object",
          properties: { payload: { type: "string" } },
          unevaluatedProperties: false,
        },
        route: { connectorId: "test", resourceId: "src", toolName: "exotic" },
      },
    ]);

    const resolved = resolveCatalogCall(
      {
        tool: "wrapper",
        args: { id: "src:exotic", arguments: { payload: "raw-bytes", extra: true } },
        executionId: "exec",
        route: { connectorId: "test", toolName: "__catalog_execute" },
      },
      entries,
    );

    expect(resolved.call.args).toEqual({ payload: "raw-bytes", extra: true });
    expect(resolved.call.tool).toBe("exotic");
  });

  it("still rejects non-object args and unknown ids", () => {
    const entries = catalogEntries(tools(1));
    expect(() =>
      resolveCatalogCall(
        {
          tool: "wrapper",
          args: { id: "missing", arguments: {} },
          executionId: "exec",
          route: { connectorId: "test", toolName: "__catalog_execute" },
        },
        entries,
      ),
    ).toThrow("unknown or not authorized");
    expect(() =>
      resolveCatalogCall(
        {
          tool: "wrapper",
          args: { id: "source-0:tool-0", arguments: ["not-an-object"] },
          executionId: "exec",
          route: { connectorId: "test", toolName: "__catalog_execute" },
        },
        entries,
      ),
    ).toThrow("must be an object");
  });

  it("uniquifies installed tool names across installs", () => {
    expect(uniquifyInstalledToolName("install-A", "delete_item")).toBe(
      "installed__install-A__delete_item",
    );
    expect(uniquifyInstalledToolName("install-B", "delete_item")).toBe(
      "installed__install-B__delete_item",
    );
  });

  it("only prefixes installed names when they collide across installs", () => {
    const tools = disambiguateInstalledToolNames([
      {
        name: "unique_op",
        description: "Only on A",
        inputSchema: { type: "object" },
        route: { connectorId: "installed", resourceId: "install-A", toolName: "unique_op" },
      },
      {
        name: "delete_item",
        description: "On A",
        inputSchema: { type: "object" },
        route: { connectorId: "installed", resourceId: "install-A", toolName: "delete_item" },
      },
      {
        name: "delete_item",
        description: "On B",
        inputSchema: { type: "object" },
        route: { connectorId: "installed", resourceId: "install-B", toolName: "delete_item" },
      },
    ]);
    expect(tools.map((tool) => tool.name)).toEqual([
      "unique_op",
      "installed__install-A__delete_item",
      "installed__install-B__delete_item",
    ]);
  });
});
