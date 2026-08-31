import type { ConnectorTool } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import {
  catalogEntries,
  loadCatalogEntry,
  SELECTED_SCHEMA_MAX_BYTES,
  searchCatalog,
  TOOL_SEARCH_LIMIT,
} from "./lazy-tool-catalog.js";

describe("lazy tool catalog", () => {
  it("caps and stably orders schema-free search results", () => {
    const tools: ConnectorTool[] = Array.from({ length: 25 }, (_, index) => ({
      name: `tool_${String(24 - index).padStart(2, "0")}`,
      description: "Shared catalog result",
      inputSchema: {
        type: "object",
        properties: { secretShape: { type: "string" } },
      },
      route: { connectorId: "test", resourceId: `source-${index}`, toolName: `tool-${index}` },
    }));

    const first = searchCatalog(catalogEntries(tools), { query: "shared", limit: 100 });
    const second = searchCatalog(catalogEntries(tools), { query: "shared", limit: 100 });

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
});
