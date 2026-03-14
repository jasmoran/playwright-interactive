# Implementation Plan: playwright-interactive MCP Server

## Context

We're building a greenfield strict TypeScript MCP server that lets an LLM agent interactively drive a headed Playwright browser. The agent sends commands one at a time, the server captures before/after snapshots (screenshot, a11y tree, HTML), records everything to a replayable `.spec.ts` file, and returns snapshot file paths. The workspace currently contains only `CLAUDE.md` with the full design spec.

## File Structure

```
playwright-interactive/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── .prettierignore
├── .gitignore
├── src/
│   ├── index.ts                        # Entry point
│   ├── server.ts                       # MCP server: tool defs + request routing
│   ├── types.ts                        # Shared interfaces
│   ├── session/
│   │   └── session-manager.ts          # Single-session lifecycle
│   ├── snapshot/
│   │   └── snapshot-capture.ts         # Screenshot, a11y, HTML capture
│   ├── command/
│   │   ├── command-executor.ts         # AsyncFunction-based eval
│   │   └── command-registry.ts         # Sequential ID tracking + command store
│   ├── pom/
│   │   └── pom-loader.ts              # Glob resolution + dynamic import via tsx
│   └── output/
│       └── output-writer.ts           # .spec.ts file generation
```

## Step-by-step Implementation

### Step 1: Project scaffolding

Create config files in this order:

**package.json** — `"type": "module"` (required for MCP SDK ESM imports). Scripts: `build`, `lint`, `format`, `format:check`, `start`.

Dependencies:
- `@modelcontextprotocol/sdk` — MCP server framework
- `playwright` — browser automation
- `@playwright/test` — for `expect` in eval scope
- `zod` — schema validation (MCP SDK peer dep)
- `glob` — POM glob resolution
- `tsx` — runtime .ts import for POM files

Dev dependencies:
- `typescript`, `@types/node` (v22)
- `eslint`, `@eslint/js`, `typescript-eslint`
- `prettier`

**tsconfig.json** — target `ES2024`, module `Node16`, moduleResolution `Node16`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`, outDir `dist`, rootDir `src`.

**eslint.config.mjs** — ESLint v9 flat config using `tseslint.config()` with `eslint.configs.recommended` + `tseslint.configs.recommended`. Ignore `dist/`.

**.prettierignore** — `dist/`, `node_modules/`, `.playwright-interactive/`

**.gitignore** — `node_modules/`, `dist/`, `.playwright-interactive/`

Run `npm install` and verify `npm run build` succeeds (with empty src).

Commit.

### Step 2: Types (`src/types.ts`)

Define all shared interfaces:

- `SnapshotSet` — `{ screenshotPath, a11yPath, htmlPath }` (all `string`)
- `CommandRecord` — `{ id: number, command: string, explanation: string | undefined, removed: boolean, beforeSnapshots: SnapshotSet, afterSnapshots: SnapshotSet, error: string | undefined }`
- `StartSessionParams` — `{ pom_paths?: string[], output_file?: string, artifacts_dir?: string }`
- `RunCommandParams` — `{ command: string, explanation?: string }`
- `RemoveCommandParams` — `{ command_id: number }`

Commit.

### Step 3: Utilities

**`src/util/logger.ts`** — `log()` and `logError()` functions that write to `process.stderr` (never stdout — stdout is the MCP JSON-RPC channel).

**`src/util/paths.ts`** — Pure functions: `sessionDirName()` returns `session-<timestamp>`, `snapshotFileName(id, phase, type)` returns e.g. `cmd-1-before-screenshot.png`.

Commit.

### Step 4: Snapshot capture (`src/snapshot/snapshot-capture.ts`)

`captureSnapshots(page, sessionDir, commandId, phase: "before" | "after"): Promise<SnapshotSet>`

Captures all three in parallel via `Promise.all`:
1. `page.screenshot({ path, fullPage: true })` → PNG
2. `page.locator("body").ariaSnapshot()` → write string to `.txt` file
3. `page.content()` → write string to `.html` file

Each individual capture wrapped in try/catch — if one fails, write error text to the file instead of crashing.

Commit.

### Step 5: POM loader (`src/pom/pom-loader.ts`)

`loadPoms(pomGlobs: string[]): Promise<LoadedPom[]>` where `LoadedPom = { className, constructor, importPath }`

1. Expand globs via `glob()` to get absolute file paths
2. Register tsx via `tsx/esm/register` for .ts import support
3. For each file: `await import(pathToFileURL(filePath).href)`
4. Extract named exports where `typeof export === "function"` (class constructors)
5. Return array of `LoadedPom`

Commit.

### Step 6: Command registry (`src/command/command-registry.ts`)

`CommandRegistry` class:
- `nextId` starts at 1
- `commands: CommandRecord[]` — flat array, never spliced
- `addCommand(...)` — assigns next sequential ID, sets `removed: false`, pushes to array
- `removeCommand(id)` — sets `removed = true` (soft delete), returns the record or undefined
- `getActiveCommands()` — filters out removed commands

Commit.

### Step 7: Command executor (`src/command/command-executor.ts`)

`executeCommand(command, page, pomClasses): Promise<{ error: string | undefined }>`

Uses `AsyncFunction` constructor (not `eval`):
```ts
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const paramNames = ["page", "expect", ...pomClassNames];
const paramValues = [page, expect, ...pomConstructors];
const fn = new AsyncFunction(...paramNames, `await (${command})`);
await fn(...paramValues);
```

Key points:
- `expect` imported from `@playwright/test`
- Commands are expressions only — wrapped with `await (...)`
- Errors caught and returned as `{ error: message }`, never thrown

Commit.

### Step 8: Output writer (`src/output/output-writer.ts`)

`generateSpecFile(commands, pomImportPaths, testTitle): string`

**Full-file regeneration** approach (not incremental append) — makes `remove_command` trivial.

1. Scan active (non-removed) commands for POM class names used
2. Generate `import { test, expect } from "@playwright/test";`
3. Generate POM import lines (relative paths via `path.relative` from output file dir)
4. Generate `test("recorded session", async ({ page }) => { ... })` with:
   - `// explanation` comment if present
   - `await command;` for each active command

`writeSpecFile(outputPath, content): Promise<void>` — writes to disk.

Commit.

### Step 9: Session manager (`src/session/session-manager.ts`)

`SessionManager` class — enforces single session.

**`startSession(params)`:**
1. Error if session already active
2. Resolve `artifacts_dir` (default `.playwright-interactive/`)
3. Create session subdir `session-<timestamp>/` via `fs.mkdir({ recursive: true })`
4. Launch browser: `chromium.launch({ headless: false })`
5. Create page: `browser.newPage()`
6. Load POMs if `pom_paths` provided (call `loadPoms`)
7. Determine output file (provided or `test-<timestamp>.spec.ts`)
8. Write initial empty spec file skeleton
9. Store session state

**`getSession()`:** Returns active session or throws.

**`endSession()`:** Closes browser, clears state, returns output file path.

Commit.

### Step 10: MCP server (`src/server.ts`)

`createServer(): Server`

Define 4 tools with JSON Schema input schemas (hand-written, not zod-to-json-schema):

| Tool | Params |
|------|--------|
| `start_session` | `pom_paths?: string[]`, `output_file?: string`, `artifacts_dir?: string` |
| `run_command` | `command: string`, `explanation?: string` |
| `remove_command` | `command_id: number` |
| `end_session` | _(none)_ |

`CallToolRequestSchema` handler routes by tool name to handler functions:
- `handleStartSession` — validates with Zod, calls `sessionManager.startSession()`, returns text result
- `handleRunCommand` — validates, captures before snapshots, executes command, captures after snapshots, registers in registry, regenerates spec file, returns command ID + all 6 snapshot paths + error if any
- `handleRemoveCommand` — validates, soft-deletes from registry, regenerates spec file
- `handleEndSession` — calls `sessionManager.endSession()`, returns output file path

All results returned as `{ content: [{ type: "text", text: "..." }] }`.

Commit.

### Step 11: Entry point (`src/index.ts`)

```ts
const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
```

Add process signal handlers (`SIGINT`, `SIGTERM`) for clean browser shutdown.

Commit.

### Step 12: Build, lint, format, and verify

- `npm run build` — clean compile
- `npm run lint` — no errors
- `npm run format` — all files formatted

Commit.

## Verification

1. **Build check:** `npm run build` compiles with zero errors
2. **Lint check:** `npm run lint` passes cleanly
3. **Format check:** `npm run format:check` passes
4. **Manual test with MCP Inspector:** `npx @modelcontextprotocol/inspector node dist/index.js`
   - Call `start_session` → verify browser window opens
   - Call `run_command` with `page.goto('https://example.com')` → verify snapshots created in `.playwright-interactive/`, command ID 1 returned
   - Call `run_command` with explanation → verify comment appears in output file
   - Call `remove_command` with ID 1 → verify command removed from spec file, snapshots kept
   - Call `end_session` → verify browser closes, spec file path returned
   - Inspect generated `.spec.ts` file for correctness

## Key Risks

- **POM .ts imports:** Mitigated by using `tsx` register for runtime TypeScript support
- **stdout corruption:** All logging via stderr; no `console.log` anywhere
- **Snapshot failures:** Each snapshot type captured independently with try/catch
- **eval security:** Intentionally trusting the agent (per design decision); commands run in isolated AsyncFunction scope with only `page`, `expect`, and POM classes available
