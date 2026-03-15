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
- `artifacts_dir` (optional): Directory for storing screenshots, a11y trees, and HTML snapshots. Defaults to `.playwright-interactive/` in the current working directory. Must persist until explicitly cleaned up by the user.

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
  - `new LoginPage(page).login('user', 'pass')` (using a loaded POM)
- `explanation` (optional but encouraged): A human-readable explanation of what this command does. Written as a comment above the command in the output file.

**Behavior:**

1. Capture **before** snapshots (screenshot, accessibility tree, HTML) and save to `artifacts_dir`.
2. Execute the command via eval. The `page` variable is always in scope. Loaded POM classes are in scope. POMs use **constructor injection** for the page instance: `new SomePage(page)`.
3. Capture **after** snapshots (screenshot, accessibility tree, HTML) and save to `artifacts_dir`.
4. Append the command (with optional explanation comment) to the output `.spec.ts` file.
5. Return a **sequential numeric command ID** (1, 2, 3, ...) along with file paths to all 6 snapshot files (before/after x screenshot/a11y/HTML).

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

Closes the browser and finalizes the session.

**Returns:** The path to the generated `.spec.ts` file.

## Generated Output File Format

The output file is a Playwright test file (`.spec.ts`) that uses **Playwright Test fixtures**. It assumes POMs are importable from the project paths. Example shape:

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
    cmd-<id>-before-screenshot.png
    cmd-<id>-before-a11y.txt
    cmd-<id>-before-html.html
    cmd-<id>-after-screenshot.png
    cmd-<id>-after-a11y.txt
    cmd-<id>-after-html.html
```

Where `<id>` is the sequential numeric command ID (1, 2, 3, ...).

Artifacts persist until the user explicitly cleans them up. There is no automatic cleanup.

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
