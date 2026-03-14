import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { executeCommand } from "./command/command-executor.js";
import { generateSpecFile, writeSpecFile } from "./output/output-writer.js";
import { SessionManager } from "./session/session-manager.js";
import { captureSnapshots } from "./snapshot/snapshot-capture.js";
import type { SnapshotSet } from "./types.js";
import { logError } from "./util/logger.js";

const StartSessionSchema = z.object({
  pom_paths: z.array(z.string()).optional(),
  output_file: z.string().optional(),
  artifacts_dir: z.string().optional(),
});

const RunCommandSchema = z.object({
  command: z.string(),
  explanation: z.string().optional(),
});

const RemoveCommandSchema = z.object({
  command_id: z.number().int().positive(),
});

function formatSnapshotPaths(label: string, snapshots: SnapshotSet): string {
  return [
    `${label}:`,
    `  screenshot: ${snapshots.screenshotPath}`,
    `  a11y: ${snapshots.a11yPath}`,
    `  html: ${snapshots.htmlPath}`,
  ].join("\n");
}

export function createServer(): Server {
  const server = new Server(
    { name: "playwright-interactive", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const sessionManager = new SessionManager();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "start_session",
        description:
          "Launch a headed Playwright browser window and start recording commands. " +
          "Optionally load Page Object Model (POM) files via glob patterns.",
        inputSchema: {
          type: "object" as const,
          properties: {
            pom_paths: {
              type: "array" as const,
              items: { type: "string" as const },
              description:
                "Optional array of glob patterns resolving to .ts POM files",
            },
            output_file: {
              type: "string" as const,
              description:
                "Optional path for the generated .spec.ts file. Defaults to a timestamp-based name.",
            },
            artifacts_dir: {
              type: "string" as const,
              description:
                "Optional directory for snapshots. Defaults to .playwright-interactive/",
            },
          },
        },
      },
      {
        name: "run_command",
        description:
          "Execute a single Playwright command against the active page. " +
          "Captures before/after snapshots (screenshot, accessibility tree, HTML). " +
          "Commands should be single expressions like page.goto('...') or new LoginPage(page).login('...'). " +
          "Provide an explanation to document the action. Do not combine multiple commands with semicolons.",
        inputSchema: {
          type: "object" as const,
          properties: {
            command: {
              type: "string" as const,
              description:
                "A single Playwright command expression, e.g. page.goto('https://example.com')",
            },
            explanation: {
              type: "string" as const,
              description:
                "Optional human-readable explanation of this command, written as a comment in the output file",
            },
          },
          required: ["command"],
        },
      },
      {
        name: "remove_command",
        description:
          "Remove a previously executed command from the output .spec.ts file by its ID. " +
          "Snapshot files are kept on disk. Use when correcting a wrong action.",
        inputSchema: {
          type: "object" as const,
          properties: {
            command_id: {
              type: "number" as const,
              description: "The sequential command ID returned by run_command",
            },
          },
          required: ["command_id"],
        },
      },
      {
        name: "end_session",
        description:
          "Close the browser and finalize the session. Returns the path to the generated .spec.ts file.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    try {
      switch (name) {
        case "start_session":
          return await handleStartSession(
            sessionManager,
            request.params.arguments,
          );
        case "run_command":
          return await handleRunCommand(
            sessionManager,
            request.params.arguments,
          );
        case "remove_command":
          return await handleRemoveCommand(
            sessionManager,
            request.params.arguments,
          );
        case "end_session":
          return await handleEndSession(sessionManager);
        default:
          return {
            content: [
              { type: "text" as const, text: `Unknown tool: ${String(name)}` },
            ],
            isError: true,
          };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`Tool ${String(name)} failed`, err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

async function handleStartSession(
  sessionManager: SessionManager,
  args: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const params = StartSessionSchema.parse(args);
  const session = await sessionManager.startSession(params);

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
}

async function handleRunCommand(
  sessionManager: SessionManager,
  args: unknown,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const params = RunCommandSchema.parse(args);
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
    params.command,
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
    command: params.command,
    explanation: params.explanation,
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
}

async function handleRemoveCommand(
  sessionManager: SessionManager,
  args: unknown,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  const params = RemoveCommandSchema.parse(args);
  const session = sessionManager.getSession();

  const removed = session.commandRegistry.removeCommand(params.command_id);
  if (removed === undefined) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Command ${String(params.command_id)} not found or already removed.`,
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
        text: `Command ${String(params.command_id)} removed from output file. Snapshot files preserved.`,
      },
    ],
  };
}

async function handleEndSession(
  sessionManager: SessionManager,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const outputFile = await sessionManager.endSession();

  return {
    content: [
      {
        type: "text" as const,
        text: `Session ended. Generated test file: ${outputFile}`,
      },
    ],
  };
}
