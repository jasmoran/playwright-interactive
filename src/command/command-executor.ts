import type { Page } from "playwright";
import { expect } from "@playwright/test";
import { logError } from "../util/logger.js";

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type AsyncFunctionConstructor = new (...args: string[]) => Function;

const AsyncFunction = Object.getPrototypeOf(async function () {})
  .constructor as AsyncFunctionConstructor;

export interface ExecutionResult {
  readonly error: string | undefined;
}

export async function executeCommand(
  command: string,
  page: Page,
  pomClasses: ReadonlyMap<string, unknown>,
): Promise<ExecutionResult> {
  const paramNames: string[] = ["page", "expect"];
  const paramValues: unknown[] = [page, expect];

  for (const [name, ctor] of pomClasses) {
    paramNames.push(name);
    paramValues.push(ctor);
  }

  try {
    const fn = new AsyncFunction(...paramNames, `await (${command})`);
    await fn(...paramValues);
    return { error: undefined };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logError("Command execution failed", err);
    return { error: message };
  }
}
