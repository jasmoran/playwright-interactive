import { executeCommand } from "./command/command-executor.js";
import { generateSpecFile, writeSpecFile } from "./output/output-writer.js";
import { loadFile } from "./loader/file-loader.js";
import {
  SessionManager,
  type SessionState,
} from "./session/session-manager.js";
import { captureSnapshots } from "./snapshot/snapshot-capture.js";
import { ElementTracker } from "./tracking/element-tracker.js";
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
    session.exportImportPaths,
    session.outputFile,
  );
  await writeSpecFile(session.outputFile, specContent);
}

const JS_RESERVED = new Set([
  "break",
  "case",
  "catch",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "finally",
  "for",
  "function",
  "if",
  "in",
  "instanceof",
  "new",
  "return",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "class",
  "const",
  "enum",
  "export",
  "extends",
  "import",
  "super",
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",
  "await",
  "async",
  "null",
  "undefined",
  "true",
  "false",
  "NaN",
  "Infinity",
]);

const BUILTIN_PARAMS = new Set(["page", "expect"]);

const VALID_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function validateAssignTo(
  assignTo: string,
  loadedExports: ReadonlyMap<string, unknown>,
): string | undefined {
  if (!VALID_IDENTIFIER.test(assignTo)) {
    return `"${assignTo}" is not a valid JavaScript identifier`;
  }
  if (JS_RESERVED.has(assignTo)) {
    return `"${assignTo}" is a reserved word`;
  }
  if (BUILTIN_PARAMS.has(assignTo)) {
    return `"${assignTo}" would shadow a built-in parameter`;
  }
  if (loadedExports.has(assignTo)) {
    return `"${assignTo}" would shadow a loaded export`;
  }
  return undefined;
}

interface StartSessionArgs {
  readonly output_file?: string | undefined;
  readonly artifacts_dir?: string | undefined;
}

export async function handleStartSession(
  sessionManager: SessionManager,
  args: StartSessionArgs,
): Promise<ToolResult> {
  const session = await sessionManager.startSession(args);

  return textResult(
    [
      "Session started.",
      `Output file: ${session.outputFile}`,
      `Artifacts directory: ${session.sessionDir}`,
    ].join("\n"),
  );
}

interface LoadFileArgs {
  readonly file_path: string;
}

export async function handleLoadFile(
  sessionManager: SessionManager,
  args: LoadFileArgs,
): Promise<ToolResult> {
  const session = sessionManager.getSession();

  try {
    const exports = await loadFile(args.file_path);

    if (exports.length === 0) {
      return textResult(
        `No classes or functions found in ${args.file_path}`,
        true,
      );
    }

    for (const exp of exports) {
      session.loadedExports.set(exp.name, exp.value);
      session.exportImportPaths.set(exp.name, exp.importPath);
    }

    const names = exports.map((e) => e.name);
    return textResult(`Loaded from ${args.file_path}: [${names.join(", ")}]`);
  } catch (err: unknown) {
    logError("load_file failed", err);
    return textResult(`Error loading file: ${getErrorMessage(err)}`, true);
  }
}

interface RunCommandArgs {
  readonly command: string;
  readonly explanation?: string | undefined;
  readonly assign_to?: string | undefined;
}

export async function handleRunCommand(
  sessionManager: SessionManager,
  args: RunCommandArgs,
): Promise<ToolResult> {
  try {
    const session = sessionManager.getSession();

    if (args.assign_to !== undefined) {
      const validationError = validateAssignTo(
        args.assign_to,
        session.loadedExports,
      );
      if (validationError !== undefined) {
        return textResult(`Invalid assign_to: ${validationError}`, true);
      }
    }

    const commandId = session.commandRegistry.peekNextId();

    const beforeSnapshots = await captureSnapshots(
      session.page,
      session.sessionDir,
      commandId,
      "before",
    );

    const tracker = new ElementTracker(session.sessionDir, commandId);
    const trackedPage = tracker.createTrackedPage(session.page);

    const { error, returnValue } = await executeCommand(
      args.command,
      trackedPage,
      session.loadedExports,
      session.assignedVars,
    );

    if (args.assign_to !== undefined && error === undefined) {
      session.assignedVars.set(args.assign_to, returnValue);
    }

    const elementScreenshots = tracker.flush();

    const afterSnapshots = await captureSnapshots(
      session.page,
      session.sessionDir,
      commandId,
      "after",
    );

    const record = session.commandRegistry.addCommand({
      command: args.command,
      explanation: args.explanation,
      assignTo: args.assign_to,
      beforeSnapshots,
      afterSnapshots,
      error,
      elementScreenshots,
    });

    await regenerateSpecFile(session);

    const resultLines = [
      `Command ID: ${String(record.id)}`,
      `Command: ${record.command}`,
      "",
      formatSnapshotPaths("Before", beforeSnapshots),
      formatSnapshotPaths("After", afterSnapshots),
    ];

    if (args.assign_to !== undefined && error === undefined) {
      resultLines.push("", `Assigned to: ${args.assign_to}`);
    }

    if (elementScreenshots.length > 0) {
      resultLines.push("", "Element screenshots:");
      for (const capture of elementScreenshots) {
        resultLines.push(
          `  ${capture.locatorDescription}.${capture.action}() -> ${capture.screenshotPath}`,
        );
      }
    }

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
  const { outputFile, videoPath, tracePath } =
    await sessionManager.endSession();
  return textResult(
    [
      "Session ended.",
      `Generated test file: ${outputFile}`,
      `Session recording: ${videoPath}`,
      `Trace file: ${tracePath}`,
    ].join("\n"),
  );
}
