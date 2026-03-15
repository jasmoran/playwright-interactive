import fs from "node:fs/promises";
import path from "node:path";
import type { CommandRecord } from "../types.js";

function computeRelativeImport(
  outputFilePath: string,
  importedFilePath: string,
): string {
  const outputDir = path.dirname(path.resolve(outputFilePath));
  let rel = path.relative(outputDir, path.resolve(importedFilePath));

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
  exportImportPaths: ReadonlyMap<string, string>,
  outputFilePath: string,
): string {
  // Determine which loaded exports are referenced in active commands
  const usedExports = new Set<string>();
  for (const cmd of commands) {
    for (const exportName of exportImportPaths.keys()) {
      if (cmd.command.includes(exportName)) {
        usedExports.add(exportName);
      }
    }
  }

  const lines: string[] = [];

  // Import playwright test
  lines.push('import { test, expect } from "@playwright/test";');

  // Import used exports, grouped by file
  const fileToClasses = new Map<string, string[]>();
  for (const className of usedExports) {
    const filePath = exportImportPaths.get(className);
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
