import path from "node:path";

export function sessionDirName(): string {
  return `session-${Date.now()}`;
}

type SnapshotType = "screenshot" | "a11y" | "html";

const EXTENSIONS: Record<SnapshotType, string> = {
  screenshot: "png",
  a11y: "txt",
  html: "html",
};

function snapshotFileName(
  commandId: number,
  phase: "before" | "after",
  type: SnapshotType,
): string {
  return `cmd-${String(commandId)}-${phase}-${type}.${EXTENSIONS[type]}`;
}

export function snapshotFilePath(
  sessionDir: string,
  commandId: number,
  phase: "before" | "after",
  type: SnapshotType,
): string {
  return path.join(sessionDir, snapshotFileName(commandId, phase, type));
}
