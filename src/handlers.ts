import { executeCommand } from "./command/command-executor.js";
import { generateSpecFile, writeSpecFile } from "./output/output-writer.js";
import {
  SessionManager,
  type SessionState,
} from "./session/session-manager.js";
import { captureSnapshots } from "./snapshot/snapshot-capture.js";
import type { SnapshotSet } from "./types.js";
import { getErrorMessage } from "./util/errors.js";
import { logError } from "./util/logger.js";

interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean | undefined;
}

function textResult(text: string, isError?: boolean): ToolResult {
  if (isError !== undefined) {
    return { content: [{ type: "text", text }], isError };
  }
  return { content: [{ type: "text", text }] };
}

function formatSnapshotPaths(label: string, snapshots: SnapshotSet): string {
  return [
    `${label}:`,
    `  screenshot: ${snapshots.screenshotPath}`,
    `  a11y: ${snapshots.a11yPath}`,
    `  html: ${snapshots.htmlPath}`,
  ].join("\n");
}

async function regenerateSpecFile(session: SessionState): Promise<void> {
  const specContent = generateSpecFile(
    session.commandRegistry.getActiveCommands(),
    session.pomImportPaths,
    session.outputFile,
  );
  await writeSpecFile(session.outputFile, specContent);
}

interface StartSessionArgs {
  readonly pom_paths?: readonly string[] | undefined;
  readonly output_file?: string | undefined;
  readonly artifacts_dir?: string | undefined;
}

export async function handleStartSession(
  sessionManager: SessionManager,
  args: StartSessionArgs,
): Promise<ToolResult> {
  const session = await sessionManager.startSession(args);

  const pomList = [...session.pomClasses.keys()];
  const pomInfo =
    pomList.length > 0
      ? `POMs loaded: [${pomList.join(", ")}]`
      : "No POMs loaded";

  return textResult(
    [
      "Session started.",
      pomInfo,
      `Output file: ${session.outputFile}`,
      `Artifacts directory: ${session.sessionDir}`,
    ].join("\n"),
  );
}

interface RunCommandArgs {
  readonly command: string;
  readonly explanation?: string | undefined;
}

export async function handleRunCommand(
  sessionManager: SessionManager,
  args: RunCommandArgs,
): Promise<ToolResult> {
  try {
    const session = sessionManager.getSession();

    const commandId = session.commandRegistry.peekNextId();

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

    await regenerateSpecFile(session);

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

    return textResult(resultLines.join("\n"), error !== undefined);
  } catch (err: unknown) {
    logError("run_command failed", err);
    return textResult(`Error: ${getErrorMessage(err)}`, true);
  }
}

interface RemoveCommandArgs {
  readonly command_id: number;
}

export async function handleRemoveCommand(
  sessionManager: SessionManager,
  args: RemoveCommandArgs,
): Promise<ToolResult> {
  const session = sessionManager.getSession();

  const removed = session.commandRegistry.removeCommand(args.command_id);
  if (removed === undefined) {
    return textResult(
      `Command ${String(args.command_id)} not found or already removed.`,
      true,
    );
  }

  await regenerateSpecFile(session);

  return textResult(
    `Command ${String(args.command_id)} removed from output file. Snapshot files preserved.`,
  );
}

export async function handleEndSession(
  sessionManager: SessionManager,
): Promise<ToolResult> {
  const outputFile = await sessionManager.endSession();
  return textResult(`Session ended. Generated test file: ${outputFile}`);
}
