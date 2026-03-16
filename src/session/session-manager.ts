import fs from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { CommandRegistry } from "../command/command-registry.js";
import type { StartSessionParams } from "../types.js";
import { log, logError } from "../util/logger.js";
import { loadEnvFile } from "../util/env-loader.js";
import { sessionDirName } from "../util/paths.js";

export interface SessionState {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly sessionDir: string;
  readonly outputFile: string;
  readonly artifactsDir: string;
  readonly commandRegistry: CommandRegistry;
  readonly loadedExports: Map<string, unknown>;
  readonly exportImportPaths: Map<string, string>;
  readonly assignedVars: Map<string, unknown>;
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

    if (params.env_file !== undefined) {
      await loadEnvFile(params.env_file);
    }

    const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"];
    if (executablePath !== undefined) {
      log(`Using custom Chromium path: ${executablePath}`);
    }
    const browser = await chromium.launch({
      headless: false,
      ...(executablePath !== undefined ? { executablePath } : {}),
    });
    const context = await browser.newContext({
      recordVideo: { dir: sessionDir },
    });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    const page = await context.newPage();

    const loadedExports = new Map<string, unknown>();
    const exportImportPaths = new Map<string, string>();

    const outputFile = path.resolve(
      params.output_file ?? generateOutputFileName(),
    );

    const commandRegistry = new CommandRegistry();

    const assignedVars = new Map<string, unknown>();

    const session: SessionState = {
      browser,
      context,
      page,
      sessionDir,
      outputFile,
      artifactsDir,
      commandRegistry,
      loadedExports,
      exportImportPaths,
      assignedVars,
    };

    this.currentSession = session;

    log(`Session started. Output: ${outputFile}`);

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

  async endSession(): Promise<{
    outputFile: string;
    videoPaths: readonly string[];
    tracePath: string;
  }> {
    const session = this.getSession();
    const outputFile = session.outputFile;
    const tracePath = path.join(session.sessionDir, "trace.zip");

    await session.context.tracing.stop({ path: tracePath });

    // Close all pages — Playwright auto-saves videos to sessionDir
    for (const page of session.context.pages()) {
      try {
        await page.close();
      } catch (err: unknown) {
        logError("Failed to close page", err);
      }
    }

    await session.context.close();
    await session.browser.close();
    this.currentSession = null;

    // Collect all video files written by Playwright
    const entries = await fs.readdir(session.sessionDir);
    const videoPaths = entries
      .filter((f) => f.endsWith(".webm"))
      .map((f) => path.join(session.sessionDir, f));

    log(
      `Session ended. Output: ${outputFile}, Videos: ${String(videoPaths.length)}`,
    );
    return { outputFile, videoPaths, tracePath };
  }
}
