# SmartShell

<img src="assets/icon.png" alt="SmartShell Icon" width="120" />

SmartShell is an Electron desktop app with:
- A real PTY terminal on the left
- An AI assistant on the right
- Shared terminal context so the assistant can explain command results and suggest next steps

## Features

- Full interactive terminal (`node-pty` + `xterm.js`)
- Streaming AI chat responses (with Stop button to cancel mid-stream)
- Provider/model selection in settings (authoritative top-level selector)
- LLM providers:
  - Local OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, etc.)
  - OpenAI Codex via OAuth
  - Gemini via OAuth (Google OpenAI-compatible endpoint)
- Assistant behavior modes:
  - `Respond when prompted`
  - `Respond automatically`
  - `Auto-run commands` (UI placeholder; not implemented)
- Command suggestion cards with:
  - `Copy` and optional `Run`
  - Risk-aware gating (`Run`, `Run (Confirm)`, or blocked)
  - Color-coded alert badges (`Needs Edit`, `Risk: low|medium|high`)
- Command safety policy in settings:
  - run mode (`strict` | `balanced` | `permissive`)
  - allowlist patterns
  - blocklist patterns
- Clear context action in UI (`Clear Context`) to flush terminal context window
- Configurable system prompt from settings

## Requirements

- Node.js 18+
- npm
- Native build prerequisites for `node-pty`

### Debian/Ubuntu dependency install

```bash
sudo apt update
sudo apt install -y nodejs npm build-essential python3 make g++
```

If you are using a local model server (Ollama, LM Studio, vLLM), run it separately and ensure it exposes OpenAI-compatible endpoints.

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

```bash
npm start
```

Development mode (with DevTools):

```bash
npm run dev
```

## Build

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

### 1. Local API Endpoint (Ollama / LM Studio / vLLM)

1. Start your local server (for Ollama: `ollama serve`)
2. Ensure at least one model is available (for Ollama: `ollama pull <model>`)
3. Open settings (`⚙`) and choose `Local API Endpoint`
4. Enter server URL (Ollama default: `http://localhost:11434`)
5. Click `Fetch Models`, select model, and save

### 2. OpenAI Codex (OAuth)

1. Open settings (`⚙`) and choose `OpenAI Codex`
2. Click `Sign in with OpenAI` and complete OAuth in browser
3. Choose a model and save

Built-in OpenAI model list:
- `gpt-5.3-codex`
- `gpt-5.2-codex`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex-mini` (default)
- `gpt-5.2`

### 3. Gemini (OAuth)

Gemini OAuth requires your own Google Cloud OAuth desktop client.

Google Cloud setup:
1. Create/select a Google Cloud project
2. Enable Gemini API / Generative Language API
3. Configure OAuth consent screen (and add test users if app is in testing)
4. Create OAuth client of type `Desktop app`
5. Copy client ID (`...apps.googleusercontent.com`)

SmartShell setup:
1. Open settings (`⚙`) and choose `Gemini OAuth`
2. Paste OAuth client ID
3. Click `Sign in with Google`
4. Click `Fetch Models`
5. Select a model and save

References:
- <https://ai.google.dev/gemini-api/docs/openai>
- <https://ai.google.dev/gemini-api/docs/oauth>

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
| `commandPolicy.runMode` | `"balanced"` | `strict` \| `balanced` \| `permissive` |
| `commandPolicy.allowlist` | `[]` | Prefix patterns trusted for command gating |
| `commandPolicy.blocklist` | `[]` | Substring patterns blocked from direct run |
| `systemPrompt` | `""` | Custom system prompt; empty uses built-in default |

## Context Behavior

- Terminal keystrokes/output are tracked and grouped into command/output pairs.
- A rolling context window is appended to every AI request.
- `Clear Context` clears this rolling window in-memory for the running app session.
- In automatic mode, SmartShell can proactively comment on newly completed commands.

## Security Notes

- `config.yaml` is gitignored and may contain local OAuth tokens/secrets.
- `nodeIntegration` is enabled in renderer; do not load untrusted web content.
- LLM settings are stored separately in your OS user-data directory (not in repo `config.yaml`).
