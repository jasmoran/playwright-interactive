import path from "node:path";
import { pathToFileURL } from "node:url";
import { log, logError } from "../util/logger.js";

export interface LoadedExport {
  readonly name: string;
  readonly value: unknown;
  readonly importPath: string;
}

let tsxRegistered = false;

async function ensureTsxRegistered(): Promise<void> {
  if (tsxRegistered) {
    return;
  }
  try {
    const { register } = await import("tsx/esm/api");
    register();
    tsxRegistered = true;
  } catch {
    log("tsx ESM loader not available, .ts files may fail to import");
  }
}

export async function loadFile(
  filePath: string,
): Promise<readonly LoadedExport[]> {
  await ensureTsxRegistered();

  const absolutePath = path.resolve(filePath);
  const fileUrl = pathToFileURL(absolutePath).href;
  const loaded: LoadedExport[] = [];

  try {
    const mod: Record<string, unknown> = (await import(fileUrl)) as Record<
      string,
      unknown
    >;

    for (const [exportName, exportValue] of Object.entries(mod)) {
      if (typeof exportValue === "function" && exportName !== "default") {
        loaded.push({
          name: exportName,
          value: exportValue,
          importPath: absolutePath,
        });
        log(`Loaded: ${exportName} from ${absolutePath}`);
      }
    }
  } catch (err: unknown) {
    logError(`Failed to load file: ${absolutePath}`, err);
    throw err;
  }

  return loaded;
}
