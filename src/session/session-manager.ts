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
import { log } from "../util/logger.js";
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
  readonly scope: Record<string, unknown>;
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

    const scope: Record<string, unknown> = {};

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
      scope,
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
    videoPath: string;
    tracePath: string;
  }> {
    const session = this.getSession();
    const outputFile = session.outputFile;
    const videoPath = path.join(session.sessionDir, "recording.webm");
    const tracePath = path.join(session.sessionDir, "trace.zip");

    const video = session.page.video();
    await session.page.close();
    if (video !== null) {
      await video.saveAs(videoPath);
    }
    await session.context.tracing.stop({ path: tracePath });
    await session.context.close();
    await session.browser.close();
    this.currentSession = null;

    log(`Session ended. Output: ${outputFile}, Video: ${videoPath}`);
    return { outputFile, videoPath, tracePath };
  }
}
