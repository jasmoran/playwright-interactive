import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  handleEndSession,
  handleLoadFile,
  handleRemoveCommand,
  handleRunCommand,
  handleStartSession,
} from "./handlers.js";
import { SessionManager } from "./session/session-manager.js";

export interface ServerInstance {
  readonly server: McpServer;
  readonly cleanup: () => Promise<void>;
}

export function createServer(): ServerInstance {
  const server = new McpServer({
    name: "playwright-interactive",
    version: "0.1.0",
  });

  const sessionManager = new SessionManager();

  server.registerTool(
    "start_session",
    {
      description:
        "Launch a headed Playwright browser window and start recording commands.",
      inputSchema: {
        output_file: z
          .string()
          .optional()
          .describe(
            "Path for the generated .spec.ts file. Defaults to a timestamp-based name.",
          ),
        artifacts_dir: z
          .string()
          .optional()
          .describe(
            "Directory for snapshots. Defaults to .playwright-interactive/",
          ),
      },
    },
    (args) => handleStartSession(sessionManager, args),
  );

  server.registerTool(
    "load_file",
    {
      description:
        "Dynamically load a TypeScript or JavaScript file during an active session. " +
        "Exported classes and functions become available in the run_command eval scope. " +
        "Can be called multiple times to load additional files.",
      inputSchema: {
        file_path: z.string().describe("Path to a .ts or .js file to load"),
      },
    },
    (args) => handleLoadFile(sessionManager, args),
  );

  server.registerTool(
    "run_command",
    {
      description:
        "Execute a single Playwright command against the active page. " +
        "Captures before/after snapshots (screenshot, accessibility tree, HTML). " +
        "Commands should be single expressions like page.goto('...') or new LoginPage(page).login('...'). " +
        "Use `assign_to` to capture a return value for use in later commands, " +
        "e.g. command: `new LoginPage(page)`, assign_to: `login`, then later command: `login.login('user', 'pass')`. " +
        "Provide an explanation to document the action. Do not combine multiple commands with semicolons.",
      inputSchema: {
        command: z
          .string()
          .describe(
            "A single Playwright command expression, e.g. page.goto('https://example.com')",
          ),
        explanation: z
          .string()
          .optional()
          .describe(
            "Human-readable explanation of this command, written as a comment in the output file",
          ),
        assign_to: z
          .string()
          .optional()
          .describe(
            "Variable name to assign the command's return value to. " +
              "Makes the value available by that name in subsequent commands. " +
              "Must be a valid JS identifier. Produces `const name = await expr;` in the output file.",
          ),
      },
    },
    (args) => handleRunCommand(sessionManager, args),
  );

  server.registerTool(
    "remove_command",
    {
      description:
        "Remove a previously executed command from the output .spec.ts file by its ID. " +
        "Snapshot files are kept on disk. Use when correcting a wrong action.",
      inputSchema: {
        command_id: z
          .number()
          .int()
          .positive()
          .describe("The sequential command ID returned by run_command"),
      },
    },
    (args) => handleRemoveCommand(sessionManager, args),
  );

  server.registerTool(
    "end_session",
    {
      description:
        "Close the browser and finalize the session. Returns the path to the generated .spec.ts file.",
    },
    () => handleEndSession(sessionManager),
  );

  async function cleanup(): Promise<void> {
    if (sessionManager.hasActiveSession()) {
      await sessionManager.endSession();
    }
  }

  return { server, cleanup };
}
