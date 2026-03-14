import fs from "node:fs/promises";
import type { Page } from "@playwright/test";
import type { SnapshotSet } from "../types.js";
import { logError } from "../util/logger.js";
import { snapshotFilePath } from "../util/paths.js";

async function captureScreenshot(page: Page, filePath: string): Promise<void> {
  try {
    await page.screenshot({ path: filePath, fullPage: true });
  } catch (err: unknown) {
    logError("Failed to capture screenshot", err);
    const message = err instanceof Error ? err.message : String(err);
    await fs.writeFile(filePath, `Screenshot failed: ${message}`);
  }
}

async function captureA11y(page: Page, filePath: string): Promise<void> {
  try {
    const snapshot = await page.locator("body").ariaSnapshot();
    await fs.writeFile(filePath, snapshot, "utf-8");
  } catch (err: unknown) {
    logError("Failed to capture accessibility snapshot", err);
    const message = err instanceof Error ? err.message : String(err);
    await fs.writeFile(filePath, `Accessibility snapshot failed: ${message}`);
  }
}

async function captureHtml(page: Page, filePath: string): Promise<void> {
  try {
    const html = await page.content();
    await fs.writeFile(filePath, html, "utf-8");
  } catch (err: unknown) {
    logError("Failed to capture HTML", err);
    const message = err instanceof Error ? err.message : String(err);
    await fs.writeFile(filePath, `HTML capture failed: ${message}`);
  }
}

export async function captureSnapshots(
  page: Page,
  sessionDir: string,
  commandId: number,
  phase: "before" | "after",
): Promise<SnapshotSet> {
  const screenshotPath = snapshotFilePath(
    sessionDir,
    commandId,
    phase,
    "screenshot",
  );
  const a11yPath = snapshotFilePath(sessionDir, commandId, phase, "a11y");
  const htmlPath = snapshotFilePath(sessionDir, commandId, phase, "html");

  await Promise.all([
    captureScreenshot(page, screenshotPath),
    captureA11y(page, a11yPath),
    captureHtml(page, htmlPath),
  ]);

  return { screenshotPath, a11yPath, htmlPath };
}
