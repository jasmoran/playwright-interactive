import { expect, type Page } from "@playwright/test";
import { getErrorMessage } from "../util/errors.js";
import { logError } from "../util/logger.js";

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type AsyncFunctionConstructor = new (...args: string[]) => Function;

const AsyncFunction = Object.getPrototypeOf(async function () {})
  .constructor as AsyncFunctionConstructor;

export interface ExecutionResult {
  readonly error: string | undefined;
  readonly returnValue: unknown;
}

export async function executeCommand(
  command: string,
  page: Page,
  loadedExports: ReadonlyMap<string, unknown>,
  assignedVars: ReadonlyMap<string, unknown>,
): Promise<ExecutionResult> {
  const paramNames: string[] = ["page", "expect"];
  const paramValues: unknown[] = [page, expect];

  for (const [name, value] of assignedVars) {
    paramNames.push(name);
    paramValues.push(value);
  }

  for (const [name, ctor] of loadedExports) {
    paramNames.push(name);
    paramValues.push(ctor);
  }

  try {
    const fn = new AsyncFunction(...paramNames, `return await (${command})`);
    const returnValue: unknown = await fn(...paramValues);
    return { error: undefined, returnValue };
  } catch (err: unknown) {
    logError("Command execution failed", err);
    return { error: getErrorMessage(err), returnValue: undefined };
  }
}
