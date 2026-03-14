import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeCommand } from "./command/command-executor.js";
import { generateSpecFile, writeSpecFile } from "./output/output-writer.js";
import { SessionManager } from "./session/session-manager.js";
import { captureSnapshots } from "./snapshot/snapshot-capture.js";
import type { SnapshotSet } from "./types.js";
import { logError } from "./util/logger.js";

function formatSnapshotPaths(label: string, snapshots: SnapshotSet): string {
  return [
    `${label}:`,
    `  screenshot: ${snapshots.screenshotPath}`,
    `  a11y: ${snapshots.a11yPath}`,
    `  html: ${snapshots.htmlPath}`,
  ].join("\n");
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "playwright-interactive",
    version: "0.1.0",
  });

  const sessionManager = new SessionManager();

  server.registerTool(
    "start_session",
    {
      description:
        "Launch a headed Playwright browser window and start recording commands. " +
        "Optionally load Page Object Model (POM) files via glob patterns.",
      inputSchema: {
        pom_paths: z
          .array(z.string())
          .optional()
          .describe("Array of glob patterns resolving to .ts POM files"),
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
    async (args) => {
      const session = await sessionManager.startSession(args);

      const pomList = [...session.pomClasses.keys()];
      const pomInfo =
        pomList.length > 0
          ? `POMs loaded: [${pomList.join(", ")}]`
          : "No POMs loaded";

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "Session started.",
              pomInfo,
              `Output file: ${session.outputFile}`,
              `Artifacts directory: ${session.sessionDir}`,
            ].join("\n"),
          },
        ],
      };
    },
  );

  server.registerTool(
    "run_command",
    {
      description:
        "Execute a single Playwright command against the active page. " +
        "Captures before/after snapshots (screenshot, accessibility tree, HTML). " +
        "Commands should be single expressions like page.goto('...') or new LoginPage(page).login('...'). " +
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
      },
    },
    async (args) => {
      try {
        const session = sessionManager.getSession();

        // Peek at next ID for snapshot file naming
        const commandId = session.commandRegistry.getAllCommands().length + 1;

        const beforeSnapshots = await captureSnapshots(
          session.page,
          session.sessionDir,
          commandId,
          "before",
        );

        const { error } = await executeCommand(
          args.command,
          session.page,
          session.pomClasses,
        );

        const afterSnapshots = await captureSnapshots(
          session.page,
          session.sessionDir,
          commandId,
          "after",
        );

        const record = session.commandRegistry.addCommand({
          command: args.command,
          explanation: args.explanation,
          beforeSnapshots,
          afterSnapshots,
          error,
        });

        // Regenerate spec file
        const specContent = generateSpecFile(
          session.commandRegistry.getActiveCommands(),
          session.pomImportPaths,
          session.outputFile,
        );
        await writeSpecFile(session.outputFile, specContent);

        const resultLines = [
          `Command ID: ${String(record.id)}`,
          `Command: ${record.command}`,
          "",
          formatSnapshotPaths("Before", beforeSnapshots),
          formatSnapshotPaths("After", afterSnapshots),
        ];

        if (error !== undefined) {
          resultLines.push("", `Error: ${error}`);
        }

        return {
          content: [{ type: "text" as const, text: resultLines.join("\n") }],
          isError: error !== undefined,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logError("run_command failed", err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
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
    async (args) => {
      const session = sessionManager.getSession();

      const removed = session.commandRegistry.removeCommand(args.command_id);
      if (removed === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Command ${String(args.command_id)} not found or already removed.`,
            },
          ],
          isError: true,
        };
      }

      // Regenerate spec file
      const specContent = generateSpecFile(
        session.commandRegistry.getActiveCommands(),
        session.pomImportPaths,
        session.outputFile,
      );
      await writeSpecFile(session.outputFile, specContent);

      return {
        content: [
          {
            type: "text" as const,
            text: `Command ${String(args.command_id)} removed from output file. Snapshot files preserved.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "end_session",
    {
      description:
        "Close the browser and finalize the session. Returns the path to the generated .spec.ts file.",
    },
    async () => {
      const outputFile = await sessionManager.endSession();

      return {
        content: [
          {
            type: "text" as const,
            text: `Session ended. Generated test file: ${outputFile}`,
          },
        ],
      };
    },
  );

  return server;
}
