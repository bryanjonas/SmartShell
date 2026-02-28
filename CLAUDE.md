# SmartShell — Claude Code Guide

## Project Overview
SmartShell is an Electron desktop app combining a PTY-based terminal (left pane) with an AI chat assistant (right pane). The AI has context awareness of commands run in the terminal. It targets OpenAI-compatible LLM backends (Ollama, LM Studio, llama.cpp, etc.).

## Tech Stack
- **Runtime:** Electron v40 + Node.js v18+
- **Terminal:** node-pty (PTY) + @xterm/xterm (UI)
- **LLM:** OpenAI-compatible streaming API via custom client
- **Config:** js-yaml
- **Build:** electron-builder (macOS .dmg target)

## Commands

```bash
npm install       # Install deps + auto-rebuilds node-pty for Electron
npm start         # Launch app
npm run dev       # Launch with DevTools open
npm run rebuild   # Manually rebuild node-pty native module
npm run build     # Package macOS .dmg (electron-builder)
```

No test framework is set up.

## Project Structure

```
src/
  main.js              # Electron main process: IPC, PTY lifecycle, LLM orchestration
  ptyManager.js        # Spawns/manages shell PTY process
  configLoader.js      # Loads/saves config.yaml (js-yaml)
  contextBuffer.js     # State machine tracking commands + outputs for LLM context
  ollamaClient.js      # OpenAI-compatible streaming LLM client
  preload.js           # Minimal preload (nodeIntegration enabled)
  renderer/
    index.html         # App shell HTML
    renderer.js        # Initialization, drag-to-resize, IPC wiring
    terminalManager.js # xterm.js wrapper, PTY routing, resize
    chatManager.js     # Chat UI, streaming message display
    settingsManager.js # Settings modal, LLM config, model discovery
    styles.css         # Dark theme stylesheet
config.default.yaml    # Config template (committed)
config.yaml            # User config (gitignored — copy from default)
```

## Architecture

**Process boundary:** Electron main process ↔ renderer via IPC.

**IPC channels:**
- `pty:input` / `pty:output` / `pty:resize` — terminal I/O
- `chat:send` / `chat:chunk` / `chat:done` / `chat:error` — LLM streaming
- `llm:fetch-models` / `llm:save-config` — settings
- `config:get` — fetch current config
- `openai:start-oauth` / `openai:disconnect` — OAuth flow

**Context flow:** PTY output → `contextBuffer.js` state machine (IDLE → COLLECTING_OUTPUT) → strips ANSI, detects prompt boundaries → ring buffer of recent (command, output) pairs → injected into LLM system prompt.

## LLM Sources

Two sources are supported, toggled in the settings panel (⚙):

1. **Local API Endpoint** — any OpenAI-compatible server (Ollama, vLLM, LM Studio, etc.). Configure URL + model.
2. **OpenAI** — uses OAuth 2.0 + PKCE with a built-in SmartShell client registration. Flow: browser opens `https://auth.openai.com/oauth/authorize` → one-shot local HTTP server catches callback on `http://localhost:1455/auth/callback` → code exchanged for access + refresh token → tokens stored in `config.yaml`.

## System Prompt

The settings panel includes an editable system prompt textarea. The built-in default (defined as `BASE_SYSTEM_PROMPT` in [src/main.js](src/main.js) and duplicated in `_getBuiltinDefaultPrompt()` in [src/renderer/settingsManager.js](src/renderer/settingsManager.js)) is used when the field is blank. Terminal context (recent commands + output) is always appended automatically regardless of which prompt is active.

## Configuration
Copy `config.default.yaml` to `config.yaml` and edit:
```yaml
llm:
  source: "local"                  # "local" | "openai"
  url: "http://localhost:11434"    # local endpoint URL
  model: "llama3.2"
terminal:
  shell: ""                        # empty = $SHELL
  fontSize: 14
context:
  maxEntries: 10
  maxOutputChars: 2000
systemPrompt: ""                   # empty = built-in default
```

## Native Module Notes
`node-pty` is a native Node addon. After `npm install`, the postinstall script calls `electron-rebuild` automatically. If the app fails to start with a module error, run `npm run rebuild`.

## electron-builder Notes
- Target: macOS `.dmg` only (app ID: `com.smartshell.app`)
- ASAR enabled; `node_modules/node-pty/build` is unpacked for native binaries
- `config.yaml` is included in the build output (ensure it's present before building)

## Key Implementation Details
- `contextBuffer.js` tracks keypresses char-by-char, handles Backspace (`0x7f`) and Ctrl+U (`0x15`)
- Prompt detection regex: `/[\$#%>]\s*$/` — may need tuning for non-standard prompts
- LLM streaming: local endpoints use `/v1/chat/completions`; ChatGPT OAuth Codex uses `https://chatgpt.com/backend-api/codex/responses`
- Drag-to-resize uses flexbox + `ResizeObserver` → fires `pty:resize` on pane change
- `nodeIntegration: true` is set — keep this in mind for security if opening untrusted content
