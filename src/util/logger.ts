export function log(message: string): void {
  process.stderr.write(`[playwright-interactive] ${message}\n`);
}

export function logError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const suffix = detail ? ` — ${detail}` : "";
  process.stderr.write(`[playwright-interactive] ERROR: ${message}${suffix}\n`);
}
