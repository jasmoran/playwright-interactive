# playwright-interactive

An MCP server that lets an LLM agent drive a real browser. The agent sends Playwright commands one at a time, and the server captures screenshots, accessibility trees, and HTML snapshots before and after each action. Every command is recorded into a `.spec.ts` file that can be replayed later with `npx playwright test`.

## How it works

1. **Start a session** — a visible Chrome window opens. Optionally load TypeScript/JavaScript files so the agent can use your project's abstractions.
2. **Send commands** — the agent sends Playwright expressions like `page.goto('https://example.com')` or `new LoginPage(page).login('user', 'pass')`. Each command produces before/after snapshots saved to disk.
3. **Correct mistakes** — if the agent takes a wrong action, it can remove that command from the recorded test file.
4. **End the session** — the browser closes and the server returns the path to the generated `.spec.ts` test file.

The generated test file is a standard Playwright test that can be run independently to reproduce the entire session.

## Tools

| Tool | Purpose |
|------|---------|
| `start_session` | Open a browser. Optionally specify output path and artifacts directory. |
| `load_file` | Load a TypeScript/JavaScript file to make its exports available in commands. |
| `run_command` | Execute a Playwright command. Returns snapshot file paths and a command ID. |
| `remove_command` | Remove a command from the output file by ID. |
| `end_session` | Close the browser and finalize the test file. Returns paths to the spec file, video recording, and trace. |

## Quick start

```bash
npm install
npx playwright install chromium
```

To test manually:

```bash
npx -y @modelcontextprotocol/inspector npm start
```

## MCP client configuration

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "playwright-interactive": {
      "command": "npx",
      "args": ["github:jasmoran/playwright-interactive"]
    }
  }
}
```

## Artifacts

Snapshots, video recordings, and traces are saved to `.playwright-interactive/` by default (configurable per session). Each session gets its own subdirectory:

```
.playwright-interactive/
  session-1710412345678/
    trace.zip
    recording.webm
    cmd-1-before-screenshot.png
    cmd-1-before-a11y.txt
    cmd-1-before-html.html
    cmd-1-after-screenshot.png
    cmd-1-after-a11y.txt
    cmd-1-after-html.html
    cmd-1-element-0.png
    ...
```

The `trace.zip` is viewable with `npx playwright show-trace trace.zip`. Element screenshots (`cmd-<id>-element-<n>.png`) are cropped images of individual elements interacted with during each command.

Artifacts persist until you delete them manually.
