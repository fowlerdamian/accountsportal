/**
 * Xero MCP server wrapper.
 *
 * The published @xeroapi/xero-mcp-server hardcodes payroll scopes in its
 * client_credentials request. Our Xero Custom Connection app only has
 * accounting scopes enabled, so the payroll scopes cause a token error.
 *
 * This wrapper patches getClientCredentialsToken to use only the scopes
 * that are actually enabled, then delegates to the real server.
 */

import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";

const require = createRequire(import.meta.url);

// Resolve the installed package path
const pkgDir = path.dirname(require.resolve("@xeroapi/xero-mcp-server/package.json"));
const clientPath = path.join(pkgDir, "dist", "clients", "xero-client.js");

// --- Patch: monkey-patch getClientCredentialsToken before the module loads ---
// We do this by importing the module and patching the exported client instance.
// The module-level code runs on import, so we need to set env vars first.

const SCOPES = "accounting.transactions accounting.contacts accounting.settings accounting.reports.read";

// Import the client module so we can patch the live instance
const clientModule = await import(pathToFileURL(clientPath).href);
const xeroClient = clientModule.xeroClient;

if (xeroClient && typeof xeroClient.getClientCredentialsToken === "function") {
  // Patch: override getClientCredentialsToken to use accounting-only scopes
  const { default: axios } = await import("axios");
  xeroClient.getClientCredentialsToken = async function () {
    const credentials = Buffer.from(
      `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
    ).toString("base64");

    const response = await axios.post(
      "https://identity.xero.com/connect/token",
      `grant_type=client_credentials&scope=${encodeURIComponent(SCOPES)}`,
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      }
    );

    const token = response.data.access_token;
    const connectionsResponse = await axios.get("https://api.xero.com/connections", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (connectionsResponse.data?.length > 0) {
      this.tenantId = connectionsResponse.data[0].tenantId;
    }

    return response.data;
  };
}

// Now start the real server (it uses the same xeroClient instance)
const { StdioServerTransport } = await import(
  "@modelcontextprotocol/sdk/server/stdio.js"
);
const { XeroMcpServer } = await import(
  pathToFileURL(path.join(pkgDir, "dist", "server", "xero-mcp-server.js")).href
);
const { ToolFactory } = await import(
  pathToFileURL(path.join(pkgDir, "dist", "tools", "tool-factory.js")).href
);

const server = XeroMcpServer.GetServer();
ToolFactory(server);

const transport = new StdioServerTransport();
await server.connect(transport);
