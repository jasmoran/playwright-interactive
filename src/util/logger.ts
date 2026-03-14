import { getErrorMessage } from "./errors.js";

export function log(message: string): void {
  process.stderr.write(`[playwright-interactive] ${message}\n`);
}

export function logError(message: string, error?: unknown): void {
  const detail = error !== undefined ? getErrorMessage(error) : "";
  const suffix = detail ? ` — ${detail}` : "";
  process.stderr.write(`[playwright-interactive] ERROR: ${message}${suffix}\n`);
}
