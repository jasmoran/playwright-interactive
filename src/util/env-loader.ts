import fs from "node:fs/promises";
import { log } from "./logger.js";

interface EnvEntry {
  readonly key: string;
  readonly value: string;
}

function parseLine(line: string): EnvEntry | undefined {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) {
    return undefined;
  }

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex === -1) {
    return undefined;
  }

  const key = trimmed.slice(0, eqIndex).trim();
  let value = trimmed.slice(eqIndex + 1).trim();

  // Strip matching quotes
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }

  if (key === "") {
    return undefined;
  }

  return { key, value };
}

export async function loadEnvFile(filePath: string): Promise<void> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");

  let count = 0;
  for (const line of lines) {
    const entry = parseLine(line);
    if (entry !== undefined) {
      process.env[entry.key] = entry.value;
      count++;
    }
  }

  log(`Loaded ${String(count)} environment variables from ${filePath}`);
}
