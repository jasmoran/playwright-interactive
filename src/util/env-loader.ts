import { config } from "dotenv";
import { log } from "./logger.js";

export function loadEnvFile(filePath: string): void {
  const result = config({ path: filePath });

  if (result.error !== undefined) {
    throw result.error;
  }

  const count = Object.keys(result.parsed ?? {}).length;
  log(`Loaded ${String(count)} environment variables from ${filePath}`);
}
