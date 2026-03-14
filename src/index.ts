import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { log, logError } from "./util/logger.js";

async function main(): Promise<void> {
  const { server, cleanup } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Server started on stdio transport");

  async function shutdown(): Promise<void> {
    log("Shutting down");
    try {
      await cleanup();
    } catch (err: unknown) {
      logError("Cleanup failed during shutdown", err);
    }
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err: unknown) => {
  logError("Fatal error", err);
  process.exit(1);
});
