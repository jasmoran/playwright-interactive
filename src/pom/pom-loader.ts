import { glob } from "glob";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { log, logError } from "../util/logger.js";

export interface LoadedPom {
  readonly className: string;
  readonly constructor: unknown;
  readonly importPath: string;
}

export async function loadPoms(
  pomGlobs: readonly string[],
): Promise<readonly LoadedPom[]> {
  // Register tsx for runtime .ts imports
  try {
    await import("tsx/esm/api");
  } catch {
    log("tsx ESM loader not available, .ts POM files may fail to import");
  }

  const filePaths: string[] = [];
  for (const pattern of pomGlobs) {
    const matches = await glob(pattern, { absolute: true });
    filePaths.push(...matches);
  }

  const uniquePaths = [...new Set(filePaths)];
  const loaded: LoadedPom[] = [];

  for (const filePath of uniquePaths) {
    try {
      const fileUrl = pathToFileURL(path.resolve(filePath)).href;
      const mod: Record<string, unknown> = (await import(fileUrl)) as Record<
        string,
        unknown
      >;

      for (const [exportName, exportValue] of Object.entries(mod)) {
        if (typeof exportValue === "function" && exportName !== "default") {
          loaded.push({
            className: exportName,
            constructor: exportValue,
            importPath: filePath,
          });
          log(`Loaded POM class: ${exportName} from ${filePath}`);
        }
      }
    } catch (err: unknown) {
      logError(`Failed to load POM file: ${filePath}`, err);
    }
  }

  return loaded;
}
