import { expect, type Page } from "@playwright/test";
import { getErrorMessage } from "../util/errors.js";
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
  loadedExports: ReadonlyMap<string, unknown>,
): Promise<ExecutionResult> {
  const paramNames: string[] = ["page", "expect"];
  const paramValues: unknown[] = [page, expect];

  for (const [name, ctor] of loadedExports) {
    paramNames.push(name);
    paramValues.push(ctor);
  }

  try {
    const fn = new AsyncFunction(...paramNames, `await (${command})`);
    await fn(...paramValues);
    return { error: undefined };
  } catch (err: unknown) {
    logError("Command execution failed", err);
    return { error: getErrorMessage(err) };
  }
}
