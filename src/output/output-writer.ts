import fs from "node:fs/promises";
import path from "node:path";
import type { CommandRecord } from "../types.js";

function computeRelativeImport(
  outputFilePath: string,
  pomFilePath: string,
): string {
  const outputDir = path.dirname(path.resolve(outputFilePath));
  let rel = path.relative(outputDir, path.resolve(pomFilePath));

  // Strip .ts extension for import statement
  rel = rel.replace(/\.ts$/, "");

  // Ensure relative path starts with ./
  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }

  return rel;
}

export function generateSpecFile(
  commands: readonly CommandRecord[],
  pomImportPaths: ReadonlyMap<string, string>,
  outputFilePath: string,
): string {
  // Determine which POM classes are referenced in active commands
  const usedPomClasses = new Set<string>();
  for (const cmd of commands) {
    for (const className of pomImportPaths.keys()) {
      if (cmd.command.includes(className)) {
        usedPomClasses.add(className);
      }
    }
  }

  const lines: string[] = [];

  // Import playwright test
  lines.push('import { test, expect } from "@playwright/test";');

  // Import used POMs, grouped by file
  const fileToClasses = new Map<string, string[]>();
  for (const className of usedPomClasses) {
    const filePath = pomImportPaths.get(className);
    if (filePath !== undefined) {
      const existing = fileToClasses.get(filePath);
      if (existing !== undefined) {
        existing.push(className);
      } else {
        fileToClasses.set(filePath, [className]);
      }
    }
  }

  for (const [filePath, classes] of fileToClasses) {
    const rel = computeRelativeImport(outputFilePath, filePath);
    lines.push(`import { ${classes.join(", ")} } from "${rel}";`);
  }

  lines.push("");
  lines.push('test("recorded session", async ({ page }) => {');

  for (const cmd of commands) {
    if (cmd.explanation !== undefined) {
      lines.push(`  // ${cmd.explanation}`);
    }
    lines.push(`  await ${cmd.command};`);
    lines.push("");
  }

  lines.push("});");
  lines.push("");

  return lines.join("\n");
}

export async function writeSpecFile(
  outputPath: string,
  content: string,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, content, "utf-8");
}
