import type {
  ConnectorCall,
  ConnectorEvent,
  ConnectorRoute,
  ConnectorTool,
} from "@rakazo/adapter-kit";
import { z } from "zod";

export const DIRECT_TOOL_LIMIT = 20;
export const TOOL_SEARCH_LIMIT = 10;
export const SELECTED_SCHEMA_MAX_BYTES = 100_000;
const MAX_QUERY_LENGTH = 200;
const MAX_TOOL_NAME_LENGTH = 200;
const MAX_TOOL_ID_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 500;
export const CATALOG_SEARCH = "__catalog_search";
export const CATALOG_LOAD = "__catalog_load";
export const CATALOG_EXECUTE = "__catalog_execute";

type CatalogEntry = { id: string; tool: ConnectorTool };

export function lazyCatalogTools(
  prefix: string,
  connectorId: string,
  label: string,
): ConnectorTool[] {
  return [
    {
      name: `${prefix}_search_tools`,
      description: `Search connected ${label} tools.`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            maxLength: MAX_QUERY_LENGTH,
            description: "Words describing the tool to find",
          },
          limit: { type: "integer", minimum: 1, maximum: TOOL_SEARCH_LIMIT },
        },
        required: ["query"],
      },
      readOnly: true,
      route: { connectorId, toolName: CATALOG_SEARCH },
    },
    {
      name: `${prefix}_load_tool`,
      description: `Load one ${label} tool's parameters by id.`,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            maxLength: MAX_TOOL_ID_LENGTH,
            description: "Exact tool ID returned by search",
          },
        },
        required: ["id"],
      },
      readOnly: true,
      route: { connectorId, toolName: CATALOG_LOAD },
    },
    {
      name: `${prefix}_execute_tool`,
      description: `Run an ${label} tool by id.`,
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            maxLength: MAX_TOOL_ID_LENGTH,
            description: "Exact tool ID returned by search",
          },
          arguments: { type: "object", description: "Arguments matching the loaded schema" },
        },
        required: ["id", "arguments"],
      },
      route: { connectorId, toolName: CATALOG_EXECUTE },
    },
  ];
}

export function isLazyCatalogControlRoute(route: ConnectorRoute | undefined): boolean {
  return Boolean(
    route &&
      !route.resourceId &&
      (route.toolName === CATALOG_SEARCH ||
        route.toolName === CATALOG_LOAD ||
        route.toolName === CATALOG_EXECUTE),
  );
}

export function catalogEntries(tools: ConnectorTool[]): CatalogEntry[] {
  return tools
    .map((tool) => ({ id: catalogEntryId(tool), tool }))
    .filter(
      ({ id, tool }) =>
        id.length <= MAX_TOOL_ID_LENGTH &&
        tool.name.length > 0 &&
        tool.name.length <= MAX_TOOL_NAME_LENGTH,
    );
}

export function searchCatalog(
  entries: CatalogEntry[],
  args: Record<string, unknown>,
): Array<{ id: string; name: string; description: string; readOnly: boolean }> {
  const query = String(args.query ?? "")
    .slice(0, MAX_QUERY_LENGTH)
    .trim()
    .toLowerCase();
  const requested = Number(args.limit ?? TOOL_SEARCH_LIMIT);
  const limit = Number.isFinite(requested)
    ? Math.max(1, Math.min(TOOL_SEARCH_LIMIT, Math.trunc(requested)))
    : TOOL_SEARCH_LIMIT;
  return entries
    .map((entry) => ({ entry, score: catalogScore(entry, query) }))
    .filter(({ score }) => !query || score < 4)
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.entry.tool.name.localeCompare(right.entry.tool.name) ||
        left.entry.id.localeCompare(right.entry.id),
    )
    .slice(0, limit)
    .map(({ entry }) => ({
      id: entry.id,
      name: entry.tool.name,
      description: entry.tool.description.slice(0, MAX_DESCRIPTION_LENGTH),
      readOnly: entry.tool.readOnly === true,
    }));
}

export function loadCatalogEntry(
  entries: CatalogEntry[],
  args: Record<string, unknown>,
): CatalogEntry {
  const id = String(args.id ?? "");
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error("Tool is unknown or not authorized for this bot");
  const schemaBytes = Buffer.byteLength(JSON.stringify(entry.tool.inputSchema), "utf8");
  if (schemaBytes > SELECTED_SCHEMA_MAX_BYTES) throw new Error("Tool schema is too large");
  return entry;
}

export function resolveCatalogCall(
  call: ConnectorCall,
  entries: CatalogEntry[],
): { call: ConnectorCall; tool: ConnectorTool } {
  const entry = loadCatalogEntry(entries, call.args);
  const args = call.args.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be an object");
  }
  const schema = z.fromJSONSchema(entry.tool.inputSchema as never);
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new Error(`Tool arguments are invalid: ${z.prettifyError(parsed.error)}`);
  }
  return {
    tool: entry.tool,
    call: {
      ...call,
      tool: entry.tool.name,
      args: parsed.data as Record<string, unknown>,
      route: entry.tool.route,
    },
  };
}

export async function* executeLazyCatalogControl(
  call: ConnectorCall,
  entries: CatalogEntry[],
  executeResolved: (resolved: ConnectorCall) => AsyncIterable<ConnectorEvent>,
): AsyncIterable<ConnectorEvent> {
  if (call.route?.toolName === CATALOG_SEARCH) {
    yield { type: "result", data: { tools: searchCatalog(entries, call.args) } };
    return;
  }
  if (call.route?.toolName === CATALOG_LOAD) {
    const entry = loadCatalogEntry(entries, call.args);
    yield {
      type: "result",
      data: {
        id: call.args.id,
        name: entry.tool.name,
        description: entry.tool.description.slice(0, MAX_DESCRIPTION_LENGTH),
        inputSchema: entry.tool.inputSchema,
        readOnly: entry.tool.readOnly === true,
      },
    };
    return;
  }
  const resolved = resolveCatalogCall(call, entries);
  yield* executeResolved(resolved.call);
}

export function uniquifyInstalledToolName(installId: string, toolName: string): string {
  return `installed__${installId}__${toolName}`;
}

/** Prefix only when the same exposed name appears on more than one install. */
export function disambiguateInstalledToolNames(tools: ConnectorTool[]): ConnectorTool[] {
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  return tools.map((tool) => {
    const resourceId = tool.route?.resourceId;
    if (!resourceId || (counts.get(tool.name) ?? 0) < 2) return tool;
    return { ...tool, name: uniquifyInstalledToolName(resourceId, tool.name) };
  });
}

function catalogEntryId(tool: ConnectorTool): string {
  const route = tool.route;
  if (!route?.resourceId) return tool.name;
  return `${route.resourceId}:${encodeURIComponent(route.toolName)}`;
}

function catalogScore(entry: CatalogEntry, query: string): number {
  if (!query) return 0;
  const name = entry.tool.name.toLowerCase();
  const description = entry.tool.description.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}
