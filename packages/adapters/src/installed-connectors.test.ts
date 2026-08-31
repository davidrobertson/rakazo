import { describe, expect, it, vi } from "vitest";
import {
  InstalledConnectorProvider,
  importOpenApiDocument,
  prepareApiInstall,
  verifyMcpInstall,
} from "./installed-connectors.js";

describe("OpenAPI connector import", () => {
  it("uses the bounded catalog for a real large installed OpenAPI source", async () => {
    const install = {
      id: "api-1",
      kind: "api",
      source: "https://api.example.test/v1",
      secretId: null,
      createdAt: new Date(0),
      config: {
        auth: { type: "none" },
        operations: Array.from({ length: 21 }, (_, index) => ({
          id: `operation_${String(index).padStart(2, "0")}`,
          description: index === 20 ? "Read the final contact" : `Operation ${index}`,
          method: "GET",
          path: `/contacts/${index}`,
          inputSchema: { type: "object", properties: { limit: { type: "integer" } } },
          readOnly: true,
        })),
      },
    };
    const prisma = {
      capabilityInstall: {
        findMany: vi.fn().mockResolvedValue([install]),
        findFirst: vi.fn().mockResolvedValue(install),
      },
    };
    const provider = new InstalledConnectorProvider(prisma as never, {} as never);
    const context = {
      workspaceId: "workspace-1",
      userId: "user-1",
      signal: new AbortController().signal,
    } as never;

    const [search, load, execute] = await provider.discoverTools(context);

    expect([search!.name, load!.name, execute!.name]).toEqual([
      "installed_search_tools",
      "installed_load_tool",
      "installed_execute_tool",
    ]);
    expect(JSON.stringify([search, load, execute])).not.toContain("operation_20");
    const events: unknown[] = [];
    for await (const event of provider.execute(
      {
        tool: search!.name,
        args: { query: "final contact" },
        executionId: "search",
        route: search!.route,
      },
      context,
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      {
        type: "result",
        data: {
          tools: [
            {
              id: "api-1:operation_20",
              name: "operation_20",
              description: "Read the final contact",
              readOnly: true,
            },
          ],
        },
      },
    ]);
    await expect(
      provider.resolveCall(
        {
          tool: execute!.name,
          args: { id: "api-1:operation_20", arguments: { limit: 5 } },
          executionId: "execute",
          route: execute!.route,
        },
        context,
      ),
    ).resolves.toMatchObject({
      tool: { name: "operation_20", readOnly: true },
      call: {
        tool: "operation_20",
        args: { limit: 5 },
        route: { connectorId: "installed", resourceId: "api-1", toolName: "operation_20" },
      },
    });
  });

  it("executes an installed API operation whose id matches a catalog control", async () => {
    const install = {
      id: "api-reserved",
      kind: "api",
      source: "https://93.184.216.34",
      secretId: null,
      createdAt: new Date(0),
      config: {
        auth: { type: "none" },
        operations: [
          {
            id: "__catalog_execute",
            method: "GET",
            path: "/reserved",
            inputSchema: { type: "object" },
          },
        ],
      },
    };
    const prisma = {
      capabilityInstall: {
        findMany: vi.fn().mockResolvedValue([install]),
        findFirst: vi.fn().mockResolvedValue(install),
      },
    };
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const provider = new InstalledConnectorProvider(prisma as never, {} as never, { fetch });
    const context = {
      workspaceId: "workspace-1",
      userId: "user-1",
      signal: new AbortController().signal,
    } as never;
    const [tool] = await provider.discoverTools(context);
    const call = { tool: tool!.name, args: {}, executionId: "reserved", route: tool!.route };

    await expect(provider.resolveCall(call, context)).resolves.toBeUndefined();
    const events = [];
    for await (const event of provider.execute(call, context)) events.push(event);

    expect(events).toEqual([{ type: "result", data: { status: 200, data: { ok: true } } }]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("maps operation ids, parameters, and JSON bodies to bounded agent tools", () => {
    const imported = importOpenApiDocument({
      openapi: "3.1.0",
      servers: [{ url: "https://api.example.test/v1" }],
      paths: {
        "/contacts/{contactId}": {
          parameters: [
            {
              name: "contactId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          patch: {
            operationId: "updateContact",
            summary: "Update one contact",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(imported.baseUrl).toBe("https://api.example.test/v1");
    expect(imported.operations).toEqual([
      expect.objectContaining({
        id: "updateContact",
        method: "PATCH",
        path: "/contacts/{contactId}",
        readOnly: false,
        inputSchema: expect.objectContaining({ required: ["contactId", "body"] }),
      }),
    ]);
  });

  it("refuses ambiguous specs without stable operation ids", () => {
    expect(() =>
      importOpenApiDocument({
        servers: [{ url: "https://api.example.test" }],
        paths: { "/contacts": { get: { summary: "List contacts" } } },
      }),
    ).toThrow("operationId");
  });

  it("refuses credentials embedded in an imported OpenAPI server URL", () => {
    expect(() =>
      importOpenApiDocument({
        servers: [{ url: "https://api.example.test?token=fake-secret" }],
        paths: { "/contacts": { get: { operationId: "listContacts" } } },
      }),
    ).toThrow("encrypted credential field");
  });

  it("refuses sensitive headers that would become model-controlled inputs", () => {
    expect(() =>
      importOpenApiDocument({
        servers: [{ url: "https://api.example.test" }],
        paths: {
          "/contacts": {
            get: {
              operationId: "listContacts",
              parameters: [{ name: "Authorization", in: "header", schema: { type: "string" } }],
            },
          },
        },
      }),
    ).toThrow("unsafe header Authorization");
  });

  it("refuses credentials embedded in a persisted MCP URL", async () => {
    await expect(
      verifyMcpInstall({
        source: "https://connectors.example.test/mcp?access_token=fake-secret",
        config: { preset: "custom", auth: { type: "none" } },
      }),
    ).rejects.toThrow("encrypted credential field");
  });

  it("refuses model-controlled sensitive headers in authored API operations", async () => {
    await expect(
      prepareApiInstall({
        source: "https://93.184.216.34",
        config: {
          auth: { type: "bearer" },
          operations: [
            {
              id: "unsafe",
              method: "GET",
              path: "/contacts",
              headerParameters: ["authorization"],
            },
          ],
        },
        credential: "fake-credential",
      }),
    ).rejects.toThrow("Sensitive headers cannot be model-controlled");
  });
});
