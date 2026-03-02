# SmartShell — Claude Code Guide

## Project Overview
SmartShell is an Electron desktop app with a split layout:
- Left pane: real interactive shell (PTY)
- Right pane: AI assistant chat

The assistant receives a rolling window of recent terminal commands/output and can be manually prompted or auto-triggered.

## Tech Stack
- Runtime: Electron v40 + Node.js v18+
- Terminal: `node-pty` + `@xterm/xterm`
- LLM transport: OpenAI-compatible streaming APIs + OpenAI Responses API via `src/ollamaClient.js`
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
  configLoader.js      # Loads/saves config.yaml and LLM settings (user-data dir)
  contextBuffer.js     # Command/output rolling context state machine
  ollamaClient.js      # Streaming client: /chat/completions or /responses (Codex)
  preload.js
  renderer/
    index.html         # App shell + settings + assistant bar
    renderer.js        # Bootstraps terminal/chat/settings and assistant controls
    terminalManager.js # xterm integration and PTY wiring
    chatManager.js     # Chat rendering, command extraction, run safety, run actions
    settingsManager.js # Provider/settings UI + save/fetch/auth orchestration
    styles.css         # UI styles
config.default.yaml    # Checked-in template (terminal/context/assistant/policy only)
config.yaml            # Local runtime config (gitignored)
```

## Current Provider Support

1. Local OpenAI-compatible endpoint (`source: local`)
2. OpenAI Codex OAuth (`source: openai`) — uses Responses API via `chatgpt.com/backend-api/codex`
3. Gemini OAuth (`source: gemini`) — uses Google's OpenAI-compatible endpoint

Provider/model selection uses an authoritative top-level selector in settings.

## Config Storage Split

LLM settings (URL, model, OAuth tokens) are stored via `loadLLMSettings`/`saveLLMSettings` in the OS user-data directory (`app.getPath('userData')`), **not** in `config.yaml`. This keeps secrets out of the project directory entirely.

`config.yaml` (and its defaults from `config.default.yaml`) holds only:
- `terminal` — shell, fontSize, fontFamily
- `context` — maxEntries, maxOutputChars
- `assistant` — mode
- `commandPolicy` — runMode, allowlist, blocklist
- `systemPrompt` — custom prompt override

## LLM Client (`ollamaClient.js`)

`LLMClient` supports two streaming modes controlled by `useResponsesAPI`:
- `false` (default): POST `/v1/chat/completions` — SSE with `data:` lines (standard)
- `true`: POST `/v1/responses` (or custom path) — SSE with named `event:` lines; text in `response.output_text.delta`

Constructor paths are configurable (`responsesPath`, `completionsPath`, `modelsPath`) to support Gemini's different URL layout. All streaming methods accept an `AbortSignal` via `options.signal`.

`createLLMClientForSource(source, url, model, token)` in `main.js` is the canonical factory — always use it instead of constructing `LLMClient` directly.

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
- `chat:stop` — cancels the active stream via AbortController
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

## Config Keys (config.yaml)

```yaml
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

## LLM Settings (user-data, never in config.yaml)

```yaml
source: local|openai|gemini
url: string                  # local endpoint base URL
model: string
openaiAccessToken: string
openaiRefreshToken: string
openaiTokenExpiry: number
geminiClientId: string
geminiAccessToken: string
geminiRefreshToken: string
geminiTokenExpiry: number
```

## Build/Packaging Notes
- `electron-builder` currently targets macOS `.dmg`
- `node-pty` is unpacked in ASAR config
- `config.yaml` is included in package files list; contains only non-secret config

## Security Notes
- `nodeIntegration: true` and `contextIsolation: false` are currently enabled
- Do not load untrusted remote content in renderer
- OAuth tokens are stored in the OS user-data directory, never in `config.yaml` or the repo
- `config.yaml` is gitignored as a convention but contains no secrets
