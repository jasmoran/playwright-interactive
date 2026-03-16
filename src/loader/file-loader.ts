import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { log, logError } from "../util/logger.js";

export interface LoadedExport {
  readonly name: string;
  readonly value: unknown;
  readonly importPath: string;
}

let tsxRegistered = false;

/**
 * Playwright's `playwright/lib/index.js` uses `process["__pw_initiator__"]`
 * as a guard to prevent being loaded twice in the same process. When the MCP
 * server (installed via npx) imports `@playwright/test`, the guard is set.
 * Loading user files that also import `@playwright/test` triggers a second
 * load from the user's node_modules, hitting the guard. We temporarily clear
 * it so the user's copy can load, then restore it.
 */
const PW_GUARD_KEY = "__pw_initiator__";

function clearPlaywrightGuard(): unknown {
  const p = process as unknown as Record<string, unknown>;
  const saved = p[PW_GUARD_KEY];
  delete p[PW_GUARD_KEY];
  return saved;
}

function restorePlaywrightGuard(saved: unknown): void {
  if (saved !== undefined) {
    (process as unknown as Record<string, unknown>)[PW_GUARD_KEY] = saved;
  }
}

/**
 * Walk up from `startDir` looking for tsconfig.json so tsx can resolve
 * path aliases (e.g. `helpers/step` → `./acceptance-tests/helpers/step`).
 */
function findTsconfig(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, "tsconfig.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

async function ensureTsxRegistered(filePath: string): Promise<void> {
  if (tsxRegistered) {
    return;
  }
  try {
    const { register } = await import("tsx/esm/api");
    const tsconfig =
      findTsconfig(path.dirname(path.resolve(filePath))) ??
      findTsconfig(process.cwd());
    if (tsconfig !== undefined) {
      log(`Using tsconfig: ${tsconfig}`);
      register({ tsconfig });
    } else {
      register();
    }
    tsxRegistered = true;
  } catch {
    log("tsx ESM loader not available, .ts files may fail to import");
  }
}

export async function loadFile(
  filePath: string,
): Promise<readonly LoadedExport[]> {
  await ensureTsxRegistered(filePath);

  const absolutePath = path.resolve(filePath);
  const fileUrl = pathToFileURL(absolutePath).href;
  const loaded: LoadedExport[] = [];

  const savedGuard = clearPlaywrightGuard();
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
  } finally {
    restorePlaywrightGuard(savedGuard);
  }

  return loaded;
}
