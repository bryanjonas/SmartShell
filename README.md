# SmartShell

<img src="assets/icon.png" alt="SmartShell Icon" width="160" />

SmartShell is an Electron desktop app with:
- A real PTY terminal on the left
- An AI assistant on the right
- Shared context between them, so the assistant can explain what just happened in your shell

## Features

- Full interactive terminal (`node-pty` + `xterm.js`)
- Streaming AI chat responses
- Terminal-aware context (recent commands + output are appended to the system prompt)
- LLM source switching:
  - Local OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, etc.)
  - OpenAI Codex via OAuth sign-in
  - Gemini via API key (Google OpenAI-compatible endpoint)
- Assistant behavior modes:
  - `Respond when prompted` (manual chat only)
  - `Respond automatically` (assistant auto-comments on completed terminal output)
  - `Auto-run commands` (UI placeholder, not implemented)
- Configurable system prompt from settings

## Requirements

- Node.js 18+
- npm
- Build prerequisites for native `node-pty`

Full dependency install (Debian/Ubuntu):

```bash
sudo apt update
sudo apt install -y nodejs npm build-essential python3 make g++
```

If using a local model server (Ollama etc.), run it separately and ensure it exposes OpenAI-compatible endpoints.

## Install

```bash
npm install
```

`postinstall` automatically rebuilds `node-pty` for Electron.
If native module errors appear, run:

```bash
npm run rebuild
```

## Run

Normal:

```bash
npm start
```

Development (with DevTools):

```bash
npm run dev
```

## Build by Platform

### macOS

Build distributable `.dmg`:

```bash
npm run build
```

### Linux

Run from source:

```bash
npm install
npm start
```

Linux packaging is not currently configured in `electron-builder` (current build target is macOS `.dmg` only).

## Provider Setup

### 1. Local API Endpoint (Ollama/LM Studio/vLLM)

1. Start your local server (for Ollama: `ollama serve`)
2. Ensure at least one model is available (for Ollama: `ollama pull <model>`)
3. In SmartShell settings (`⚙`), select `Local API Endpoint`
4. Enter server URL (for Ollama default: `http://localhost:11434`)
5. Click `Fetch Models`, choose a model, then save

### 2. OpenAI Codex (OAuth)

1. In settings (`⚙`), select `OpenAI Codex`
2. Click `Sign in with OpenAI` and finish OAuth in browser
3. Choose a model and save

Current built-in Codex model list:
- `gpt-5.3-codex`
- `gpt-5.2-codex`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex-mini` (default)
- `gpt-5.2`

### 3. Gemini (API Key)

1. Create a Gemini API key in Google AI Studio
2. In settings (`⚙`), select `Gemini API Key`
3. Paste your key
4. Click `Fetch Models`
5. Choose a fetched model and save

## Configuration

LLM provider settings (URL, model, API keys, OAuth tokens) are managed exclusively
through the in-app settings panel (`⚙`). They are stored in your OS user-data directory
and are never written to `config.yaml` or the project directory.

`config.yaml` controls terminal appearance and assistant behavior. If missing, defaults
are used. Start from the provided template:

```bash
cp config.default.yaml config.yaml
```

| Key | Default | Description |
|-----|---------|-------------|
| `terminal.shell` | `""` | Shell to launch; empty uses `$SHELL` |
| `terminal.fontSize` | `14` | xterm.js font size (px) |
| `terminal.fontFamily` | `"Cascadia Code, ..."` | xterm.js font family |
| `context.maxEntries` | `10` | Command/output pairs kept for LLM context |
| `context.maxOutputChars` | `2000` | Max output chars stored per command |
| `assistant.mode` | `"prompted"` | `prompted` \| `automatic` \| `autorun` |
| `systemPrompt` | `""` | Custom system prompt; empty uses built-in default |

## How Context Works

- Keystrokes are tracked to detect command boundaries.
- Terminal output is cleaned (ANSI/OSC stripped) and attached to the command.
- A rolling buffer of recent entries is injected into the system prompt on each request.

In `Respond automatically` mode, SmartShell also triggers proactive assistant comments when new command output is finalized.

## Notes

- `nodeIntegration` is enabled in the renderer; do not load untrusted content.
- `config.yaml` is gitignored. LLM settings are stored separately in your OS user-data directory (`~/Library/Application Support/SmartShell/` on macOS).
