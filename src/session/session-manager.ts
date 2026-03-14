import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { CommandRegistry } from "../command/command-registry.js";
import { loadPoms, type LoadedPom } from "../pom/pom-loader.js";
import type { StartSessionParams } from "../types.js";
import { log } from "../util/logger.js";
import { sessionDirName } from "../util/paths.js";

export interface SessionState {
  readonly browser: Browser;
  readonly page: Page;
  readonly sessionDir: string;
  readonly outputFile: string;
  readonly artifactsDir: string;
  readonly commandRegistry: CommandRegistry;
  readonly pomClasses: ReadonlyMap<string, unknown>;
  readonly pomImportPaths: ReadonlyMap<string, string>;
}

function generateOutputFileName(): string {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[T]/g, "-")
    .replace(/[:]/g, "")
    .replace(/\..+$/, "");
  return `test-${timestamp}.spec.ts`;
}

export class SessionManager {
  private currentSession: SessionState | null = null;

  async startSession(params: StartSessionParams): Promise<SessionState> {
    if (this.currentSession !== null) {
      throw new Error("A session is already active. Call end_session first.");
    }

    const artifactsDir = path.resolve(
      params.artifacts_dir ?? ".playwright-interactive",
    );
    const sessionDir = path.join(artifactsDir, sessionDirName());
    await fs.mkdir(sessionDir, { recursive: true });

    log(`Session directory: ${sessionDir}`);

    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    const pomClasses = new Map<string, unknown>();
    const pomImportPaths = new Map<string, string>();
    const loadedPomList: readonly LoadedPom[] =
      params.pom_paths !== undefined && params.pom_paths.length > 0
        ? await loadPoms(params.pom_paths)
        : [];

    for (const pom of loadedPomList) {
      pomClasses.set(pom.className, pom.constructor);
      pomImportPaths.set(pom.className, pom.importPath);
    }

    const outputFile = path.resolve(
      params.output_file ?? generateOutputFileName(),
    );

    const commandRegistry = new CommandRegistry();

    const session: SessionState = {
      browser,
      page,
      sessionDir,
      outputFile,
      artifactsDir,
      commandRegistry,
      pomClasses,
      pomImportPaths,
    };

    this.currentSession = session;

    log(
      `Session started. POMs: [${[...pomClasses.keys()].join(", ")}]. Output: ${outputFile}`,
    );

    return session;
  }

  getSession(): SessionState {
    if (this.currentSession === null) {
      throw new Error("No active session. Call start_session first.");
    }
    return this.currentSession;
  }

  hasActiveSession(): boolean {
    return this.currentSession !== null;
  }

  async endSession(): Promise<string> {
    const session = this.getSession();
    const outputFile = session.outputFile;

    await session.browser.close();
    this.currentSession = null;

    log(`Session ended. Output: ${outputFile}`);
    return outputFile;
  }
}
