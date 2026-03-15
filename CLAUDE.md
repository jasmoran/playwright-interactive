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
- `explanation` (optional but encouraged): A human-readable explanation of what this command does. Written as a comment above the command in the output file.

**Behavior:**

1. Capture **before** snapshots (screenshot, accessibility tree, HTML) and save to `artifacts_dir`.
2. Execute the command via eval with a **proxied page** that tracks element interactions. The `page` variable is always in scope. Exports loaded via `load_file` are in scope. Loaded classes use **constructor injection** for the page instance: `new SomePage(page)`.
3. Capture **element-level screenshots** of each element interacted with during the command (via `locator.screenshot()`). These are cropped images of just the target element, captured before each action (click, fill, etc.).
4. Capture **after** snapshots (screenshot, accessibility tree, HTML) and save to `artifacts_dir`.
5. Append the command (with optional explanation comment) to the output `.spec.ts` file.
6. Return a **sequential numeric command ID** (1, 2, 3, ...) along with file paths to all 6 snapshot files (before/after x screenshot/a11y/HTML) and any element screenshot paths.

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

Closes the browser and finalizes the session. The session video recording is saved as `recording.webm` and the Playwright trace is saved as `trace.zip` in the session artifacts directory.

**Returns:** The path to the generated `.spec.ts` file, the session video recording, and the trace file.

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

## Artifact Storage

All snapshots are stored under `artifacts_dir` (default: `.playwright-interactive/`). Structure:

```
.playwright-interactive/
  session-<timestamp>/
    trace.zip
    recording.webm
    cmd-<id>-before-screenshot.png
    cmd-<id>-before-a11y.txt
    cmd-<id>-before-html.html
    cmd-<id>-after-screenshot.png
    cmd-<id>-after-a11y.txt
    cmd-<id>-after-html.html
    cmd-<id>-element-0.png
    cmd-<id>-element-1.png
```

The `trace.zip` file is a full Playwright trace (viewable with `npx playwright show-trace trace.zip`). The `recording.webm` file is a video recording of the entire browser session. Element screenshot files (`cmd-<id>-element-<n>.png`) are cropped images of individual elements interacted with during each command.

Where `<id>` is the sequential numeric command ID (1, 2, 3, ...).

Artifacts persist until the user explicitly cleans them up. There is no automatic cleanup.

## Element Tracking

Element-level screenshots are captured using a **Proxy-based approach** (`src/tracking/element-tracker.ts`). A JS `Proxy` wraps the `Page` object to intercept locator-creation methods (`getByRole`, `getByLabel`, `locator`, etc.), returning proxied `Locator` objects. These proxied locators intercept action methods (`click`, `fill`, `hover`, etc.) and capture `locator.screenshot()` of the target element before each action executes.

This approach works transparently through POM classes: since the proxied page is passed to constructors via eval, any locator methods called inside POM methods are automatically tracked.

The proxied page is only used during `executeCommand`. Snapshot capture (`captureSnapshots`) always uses the real page to avoid spurious element captures from internal locator calls like `page.locator("body").ariaSnapshot()`.

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
npm run build       # Compile TypeScript
npm run lint        # Run ESLint
npm run format      # Run Prettier
npm run start       # Start the MCP server (stdio)
```
