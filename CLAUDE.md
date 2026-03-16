# playwright-interactive

A strict TypeScript MCP server that enables an LLM agent to interactively control a headed Playwright browser session, capturing snapshots at each step and producing a replayable `.spec.ts` test file.

## Project Setup

- **Language:** TypeScript (strictest settings)
- **Runtime:** Node 22 (ES2024 target)
- **Package manager:** npm
- **Formatting:** Prettier (default config)
- **Linting:** ESLint recommended + @typescript-eslint/recommended
- **Transport:** stdio (standard MCP transport)

## Architecture

The server exposes five MCP tools: `start_session`, `load_file`, `run_command`, `remove_command`, and `end_session`. Only one session may be active at a time.

### start_session

Starts a **headed** Playwright browser window.

**Parameters:**

- `output_file` (optional): Name/path for the generated `.spec.ts` file. Defaults to a timestamp-based name like `test-2026-03-14-143022.spec.ts`.
- `artifacts_dir` (optional): Directory for storing screenshots, a11y trees, HTML snapshots, and session video recordings. Defaults to `.playwright-interactive/` in the current working directory. Must persist until explicitly cleaned up by the user.
- `env_file` (optional): Path to a `.env` file to load into the server's environment variables before launching the browser. Variables are set on `process.env` and are available to subsequent operations (e.g., `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can be set in the env file).

**Returns:** Confirmation with output file path.

### load_file

Dynamically loads a TypeScript/JavaScript file during an active session, making its exported classes and functions available in the `run_command` eval scope. Can be called multiple times to load additional files as needed.

**Parameters:**

- `file_path` (required): Path to a `.ts` or `.js` file to load.

**Behavior:**

- Dynamically imports the file via tsx.
- Extracts all named exports that are functions (class constructors) and adds them to the eval scope.
- Tracks the import path for inclusion in the generated `.spec.ts` file.

**Returns:** List of class/function names loaded from the file.

### run_command

Executes a single Playwright command via **eval** against the active page.

**Parameters:**

- `command` (required): A single Playwright command string. Examples:
  - `page.goto('https://example.com')`
  - `page.getByLabel('Email').fill('user@example.com')`
  - `new LoginPage(page).login('user', 'pass')` (using a loaded file)
  - `login.login('user', 'pass')` (using a previously assigned variable)
  - `context.newPage()` (create a new tab, use with `assign_to`)
  - `adminPage.goto('https://example.com/admin')` (using an assigned page)
- `explanation` (optional but encouraged): A human-readable explanation of what this command does. Written as a comment above the command in the output file.
- `assign_to` (optional): Variable name to assign the command's return value to. The value becomes available by that name in subsequent commands. Must be a valid JS identifier and must not shadow built-in parameters (`page`, `context`, `expect`) or loaded exports. Produces `const name = await expr;` in the output file.

**Behavior:**

1. Capture **before** snapshots (screenshot, accessibility tree, HTML) for all known pages and save to `artifacts_dir`. Closed pages are skipped.
2. Execute the command via eval with **proxied pages** that track element interactions. The `page` variable (the default page) and `context` (the browser context) are always in scope. Exports loaded via `load_file` are in scope. Loaded classes use **constructor injection** for the page instance: `new SomePage(page)`. Variables assigned via `assign_to` in previous commands are also in scope by name — including any additional Page objects. All Page objects in scope are proxied for element tracking. When `assign_to` is provided, the command's return value is captured and stored for use in subsequent commands.
3. Capture **element-level screenshots** of each element interacted with during the command (via `locator.screenshot()`). These are cropped images of just the target element, captured before each action (click, fill, etc.). Element tracking works across all known pages.
4. Determine which pages were **touched** (had locator methods called on them) during command execution. Snapshots for untouched pages are discarded. Newly created pages (via `context.newPage()` with `assign_to`) are always included.
5. Capture **after** snapshots for touched pages and newly created pages, and save to `artifacts_dir`.
6. Append the command (with optional explanation comment) to the output `.spec.ts` file.
7. Return a **sequential numeric command ID** (1, 2, 3, ...) along with file paths to all snapshot files (per-page before/after x screenshot/a11y/HTML) and any element screenshot paths.

**Error handling:** If the command throws (element not found, timeout, etc.), catch the error and return it as part of the MCP result. Still capture after-snapshots so the agent can see the page state.

**Important constraints:**

- Executing multiple commands in one call (e.g., semicolon-separated) is **discouraged**. Each `run_command` should contain exactly one action.
- Snapshots are returned as **file paths only** (not inline/base64).
- Accessibility tree uses Playwright's built-in `ariaSnapshot` format.

### remove_command

Removes a previously executed command from the output `.spec.ts` file.

**Parameters:**

- `command_id` (required): The unique ID returned by `run_command`.

**Behavior:**

- Removes the command (and its explanation comment, if any) from the output file.
- Does **NOT** delete associated snapshot files from disk.

**Use case:** When the agent makes a wrong move and needs to correct the recorded test flow.

### end_session

Closes the browser and finalizes the session. All pages are closed, and Playwright automatically saves one video recording per page to the session artifacts directory. The Playwright trace is saved as `trace.zip`.

**Returns:** The path to the generated `.spec.ts` file, all session video recordings, and the trace file.

## Generated Output File Format

The output file is a Playwright test file (`.spec.ts`) that uses **Playwright Test fixtures**. It assumes loaded files are importable from the project paths. Example shape:

```typescript
import { test, expect } from "@playwright/test";
import { LoginPage } from "./poms/LoginPage";

test("recorded session", async ({ page }) => {
  // Navigate to the login page
  await page.goto("https://example.com/login");

  // Log in with test credentials
  await new LoginPage(page).login("user@test.com", "password123");

  // Verify we landed on the dashboard
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
```

When `assign_to` is used to capture values, the output uses `const` declarations:

```typescript
import { test, expect } from "@playwright/test";
import { LoginPage } from "./poms/LoginPage";

test("recorded session", async ({ page }) => {
  // Navigate to the login page
  await page.goto("https://example.com/login");

  // Initialize the login page
  const login = await new LoginPage(page);

  // Log in with test credentials
  await login.login("user@test.com", "password123");

  // Verify we landed on the dashboard
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
```

The output always destructures both `page` and `context` from the test fixture, so `context` is available for multi-page tests:

```typescript
import { test, expect } from "@playwright/test";

test("recorded session", async ({ page, context }) => {
  await page.goto("https://example.com");

  // Open admin page in new tab
  const admin = await context.newPage();

  // Navigate admin tab
  await admin.goto("https://example.com/admin");
});
```

## Artifact Storage

All snapshots are stored under `artifacts_dir` (default: `.playwright-interactive/`). Structure:

```
.playwright-interactive/
  session-<timestamp>/
    trace.zip
    *.webm                                          (one video per page, auto-named by Playwright)
    cmd-<id>-<pageName>-before-screenshot.png
    cmd-<id>-<pageName>-before-a11y.txt
    cmd-<id>-<pageName>-before-html.html
    cmd-<id>-<pageName>-after-screenshot.png
    cmd-<id>-<pageName>-after-a11y.txt
    cmd-<id>-<pageName>-after-html.html
    cmd-<id>-element-0.png
    cmd-<id>-element-1.png
```

The `trace.zip` file is a full Playwright trace (viewable with `npx playwright show-trace trace.zip`). Playwright automatically records one `.webm` video per page. Snapshot files include the page name (e.g., `cmd-1-page-before-screenshot.png`, `cmd-1-admin-before-screenshot.png`) to distinguish snapshots from different pages. Element screenshot files (`cmd-<id>-element-<n>.png`) are cropped images of individual elements interacted with during each command.

Where `<id>` is the sequential numeric command ID (1, 2, 3, ...) and `<pageName>` is the variable name of the page (`page` for the default page, or the `assign_to` name for additional pages).

Artifacts persist until the user explicitly cleans them up. There is no automatic cleanup.

## Element Tracking

Element-level screenshots are captured using a **Proxy-based approach** (`src/tracking/element-tracker.ts`). A JS `Proxy` wraps each `Page` object to intercept locator-creation methods (`getByRole`, `getByLabel`, `locator`, etc.), returning proxied `Locator` objects. These proxied locators intercept action methods (`click`, `fill`, `hover`, etc.) and capture `locator.screenshot()` of the target element before each action executes.

All known Page objects (the default `page` plus any pages stored via `assign_to`) are proxied for element tracking. This means element tracking works across multiple pages and tabs. All proxied pages share the same tracker state, so element captures from any page are collected together.

This approach works transparently through POM classes: since the proxied page is passed to constructors via eval, any locator methods called inside POM methods are automatically tracked.

Proxied pages are only used during `executeCommand`. Snapshot capture (`captureSnapshots`) always uses the real pages to avoid spurious element captures from internal locator calls like `page.locator("body").ariaSnapshot()`.

## Tracing

Full Playwright tracing is enabled for all sessions. Tracing starts when the browser context is created and stops when the session ends. The trace file is saved as `trace.zip` in the session directory and can be viewed with `npx playwright show-trace trace.zip`.

## Code Standards

- All TypeScript strict mode options enabled (`strict: true` in tsconfig, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.)
- Prettier for all formatting (no custom config, use defaults)
- ESLint with `eslint:recommended` and `@typescript-eslint/recommended`
- No `any` types — use `unknown` and narrow
- All functions must have explicit return types
- Prefer `const` over `let`, never use `var`

## Workflow Rules

- **ALWAYS commit changes after completing any task or block of work.** No work is considered done until it is committed.
- **ALWAYS update this CLAUDE.md file** with any memories, learnings, or whenever your understanding of the project changes. This includes new conventions discovered, architectural decisions made, gotchas encountered, debugging insights, or corrections to previous assumptions. This file is the living source of truth for the project.

## Development Commands

```bash
npm run build        # Compile TypeScript
npm run lint         # Run ESLint
npm run format       # Run Prettier
npm run format:check # Check Prettier formatting
npm run start        # Start the MCP server (stdio)
```
