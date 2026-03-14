import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { log, logError } from "./util/logger.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Server started on stdio transport");
}

process.on("SIGINT", () => {
  log("Received SIGINT, shutting down");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Received SIGTERM, shutting down");
  process.exit(0);
});

main().catch((err: unknown) => {
  logError("Fatal error", err);
  process.exit(1);
});
