# SmartShell — Claude Code Guide

## Project Overview
SmartShell is an Electron desktop app with a split layout:
- Left pane: real interactive shell (PTY)
- Right pane: AI assistant chat

The assistant receives a rolling window of recent terminal commands/output and can be manually prompted or auto-triggered.

## Tech Stack
- Runtime: Electron v40 + Node.js v18+
- Terminal: `node-pty` + `@xterm/xterm`
- LLM transport: OpenAI-compatible streaming APIs via `src/ollamaClient.js`
- Config: `js-yaml`
- Packaging: `electron-builder` (macOS `.dmg` target)

## NPM Commands

```bash
npm install       # Install deps + auto-rebuild node-pty for Electron
npm start         # Launch app
npm run dev       # Launch with DevTools open
npm run rebuild   # Manually rebuild node-pty
npm run build     # Package macOS .dmg
```

No automated test suite is currently configured.

## Project Structure

```text
src/
  main.js              # Main process: IPC, PTY lifecycle, provider auth, prompt assembly
  ptyManager.js        # PTY spawn/write/resize wrappers
  configLoader.js      # Loads/saves config.yaml with defaults merge
  contextBuffer.js     # Command/output rolling context state machine
  ollamaClient.js      # OpenAI-compatible streaming client (/chat/completions or /responses)
  preload.js
  renderer/
    index.html         # App shell + settings + assistant bar
    renderer.js        # Bootstraps terminal/chat/settings and assistant controls
    terminalManager.js # xterm integration and PTY wiring
    chatManager.js     # Chat rendering, command extraction, run safety, run actions
    settingsManager.js # Provider/settings UI + save/fetch/auth orchestration
    styles.css         # UI styles
config.default.yaml    # Checked-in template
config.yaml            # Local runtime config (gitignored)
```

## Current Provider Support

1. Local OpenAI-compatible endpoint (`source: local`)
2. OpenAI Codex OAuth (`source: openai`)
3. Gemini OAuth (`source: gemini`)

Provider/model selection uses an authoritative top-level selector in settings.

## Command Suggestion Safety System

Implemented in `src/renderer/chatManager.js` with policy data from config:
- Command extraction from fenced and inline backticks
- Intent markers supported in model output (`[runnable]`, `[example]`)
- Confidence scoring + risk classification (`low`/`medium`/`high`)
- Policy modes:
  - `strict`
  - `balanced`
  - `permissive`
- Allowlist/blocklist pattern checks
- UI badges per command card:
  - status (`Needs Edit`/`Blocked` when applicable)
  - risk (`Risk: low|medium|high`)
- Run behavior:
  - direct run for allowed commands
  - `Run (Confirm)` + confirm modal for gated commands
  - pre-run syntax precheck via main IPC (`command:precheck`)

## Context Window Behavior

Context is stored in `contextBuffer` as recent command/output entries.
- Appends to every LLM request in `buildSystemPrompt()`
- `Clear Context` button in the assistant bar calls `context:clear`
- Clear operation resets entries + pending state + auto timers
- When empty, system prompt explicitly says context is empty and instructs model not to claim prior command visibility

## Key IPC Channels

Terminal:
- `pty:input`, `pty:output`, `pty:resize`

Chat streaming:
- `chat:send`, `chat:chunk`, `chat:done`, `chat:error`
- `autochat:start`, `autochat:chunk`, `autochat:done`, `autochat:error`

Settings/config:
- `config:get`
- `llm:fetch-models`
- `llm:save-config`
- `assistant:set-mode`
- `context:clear`
- `command:precheck`

OAuth:
- `openai:start-oauth`, `openai:disconnect`
- `gemini:start-oauth`, `gemini:disconnect`

## Config Keys (effective)

```yaml
llm:
  source: local|openai|gemini
  url: string
  model: string
  openaiAccessToken/openaiRefreshToken/openaiTokenExpiry
  geminiClientId/geminiAccessToken/geminiRefreshToken/geminiTokenExpiry

terminal:
  shell: string
  fontSize: number
  fontFamily: string

context:
  maxEntries: number
  maxOutputChars: number

assistant:
  mode: prompted|automatic|autorun

commandPolicy:
  runMode: strict|balanced|permissive
  allowlist: string[]
  blocklist: string[]

systemPrompt: string
```

## Build/Packaging Notes
- `electron-builder` currently targets macOS `.dmg`
- `node-pty` is unpacked in ASAR config
- `config.yaml` is included in package files list; treat it as sensitive local state

## Security Notes
- `nodeIntegration: true` and `contextIsolation: false` are currently enabled
- Do not load untrusted remote content in renderer
- Keep `config.yaml` out of version control (contains local tokens/secrets)
