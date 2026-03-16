import type { Locator, Page } from "@playwright/test";
import type { ElementCapture } from "../types.js";
import { logError } from "../util/logger.js";
import { elementScreenshotPath } from "../util/paths.js";

const PAGE_LOCATOR_METHODS: ReadonlySet<string> = new Set([
  "locator",
  "getByRole",
  "getByLabel",
  "getByText",
  "getByPlaceholder",
  "getByTestId",
  "getByTitle",
  "getByAltText",
]);

const LOCATOR_CHAINING_METHODS: ReadonlySet<string> = new Set([
  "and",
  "or",
  "filter",
  "nth",
  "first",
  "last",
  "locator",
  "getByRole",
  "getByLabel",
  "getByText",
  "getByPlaceholder",
  "getByTestId",
  "getByTitle",
  "getByAltText",
]);

const LOCATOR_ACTION_METHODS: ReadonlySet<string> = new Set([
  "click",
  "dblclick",
  "fill",
  "check",
  "uncheck",
  "press",
  "type",
  "selectOption",
  "hover",
  "focus",
  "tap",
  "setChecked",
  "selectText",
  "setInputFiles",
  "clear",
  "dragTo",
]);

function formatArg(arg: unknown): string {
  if (typeof arg === "string") {
    return `'${arg}'`;
  }
  if (arg instanceof RegExp) {
    return arg.toString();
  }
  if (typeof arg === "number" || typeof arg === "boolean") {
    return String(arg);
  }
  if (arg === null) {
    return "null";
  }
  if (arg === undefined) {
    return "undefined";
  }
  return JSON.stringify(arg);
}

function formatCall(methodName: string, args: readonly unknown[]): string {
  const formattedArgs = args.map(formatArg).join(", ");
  return `${methodName}(${formattedArgs})`;
}

async function captureElement(
  locator: Locator,
  locatorDescription: string,
  action: string,
  sessionDir: string,
  commandId: number,
  captureIndex: number,
): Promise<ElementCapture | undefined> {
  const screenshotPath = elementScreenshotPath(
    sessionDir,
    commandId,
    captureIndex,
  );
  try {
    await locator.screenshot({ path: screenshotPath, timeout: 3000 });
    return { locatorDescription, action, screenshotPath };
  } catch (err: unknown) {
    logError(
      `Element screenshot failed for ${locatorDescription}.${action}()`,
      err,
    );
    return undefined;
  }
}

function createTrackedLocator(
  realLocator: Locator,
  description: string,
  state: TrackerState,
): Locator {
  return new Proxy(realLocator, {
    get(target: Locator, prop: string | symbol, receiver: unknown): unknown {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }

      if (LOCATOR_CHAINING_METHODS.has(prop)) {
        const realMethod = Reflect.get(target, prop, target) as (
          ...args: unknown[]
        ) => Locator;
        return (...args: unknown[]): Locator => {
          const chained = realMethod.apply(target, args) as Locator;
          const newDescription = `${description}.${formatCall(prop, args)}`;
          return createTrackedLocator(chained, newDescription, state);
        };
      }

      if (LOCATOR_ACTION_METHODS.has(prop)) {
        const realMethod = Reflect.get(target, prop, target) as (
          ...args: unknown[]
        ) => Promise<unknown>;
        return async (...args: unknown[]): Promise<unknown> => {
          const index = state.captureIndex++;
          const capture = await captureElement(
            target,
            description,
            prop,
            state.sessionDir,
            state.commandId,
            index,
          );
          if (capture !== undefined) {
            state.captures.push(capture);
          }
          return realMethod.apply(target, args);
        };
      }

      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }
      return value;
    },
  }) as Locator;
}

interface TrackerState {
  readonly sessionDir: string;
  readonly commandId: number;
  readonly captures: ElementCapture[];
  readonly touchedPages: Set<string>;
  captureIndex: number;
}

export class ElementTracker {
  private readonly state: TrackerState;

  constructor(sessionDir: string, commandId: number) {
    this.state = {
      sessionDir,
      commandId,
      captures: [],
      touchedPages: new Set(),
      captureIndex: 0,
    };
  }

  flush(): readonly ElementCapture[] {
    return [...this.state.captures];
  }

  getTouchedPageNames(): ReadonlySet<string> {
    return this.state.touchedPages;
  }

  private createTrackedPage(realPage: Page, pageName: string): Page {
    const state = this.state;

    return new Proxy(realPage, {
      get(target: Page, prop: string | symbol, receiver: unknown): unknown {
        if (typeof prop === "string" && PAGE_LOCATOR_METHODS.has(prop)) {
          const realMethod = Reflect.get(target, prop, target) as (
            ...args: unknown[]
          ) => Locator;
          return (...args: unknown[]): Locator => {
            state.touchedPages.add(pageName);
            const realLocator = realMethod.apply(target, args) as Locator;
            const description = formatCall(prop, args);
            return createTrackedLocator(realLocator, description, state);
          };
        }

        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return (value as (...args: unknown[]) => unknown).bind(target);
        }
        return value;
      },
    }) as Page;
  }

  createTrackedPages(
    pages: ReadonlyMap<string, Page>,
  ): ReadonlyMap<string, Page> {
    const result = new Map<string, Page>();
    for (const [name, page] of pages) {
      result.set(name, this.createTrackedPage(page, name));
    }
    return result;
  }
}
