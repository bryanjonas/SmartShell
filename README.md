# SmartShell

A split-pane desktop terminal with an AI assistant powered by Ollama.

## Layout

```
┌─────────────────────────┬──────────────────────────┐
│  Terminal                │  AI Assistant            │
│                          │                          │
│  $ ssh user@host         │  Ask me about your       │
│  $ ls -la                │  terminal session...     │
│  total 48                │                          │
│  drwxr-xr-x ...          │  [__________________]    │
└─────────────────────────┴──────────────────────────┘
```

- **Left pane**: Full interactive terminal (PTY-based). SSH, vim, htop — everything works.
- **Right pane**: Chat with an LLM that knows about the commands you've run and their output.
- **Drag** the center divider to resize the panes.

## Prerequisites

1. **Node.js** (v18+) and **npm**
2. **Ollama** running locally: `ollama serve`
3. A model pulled in Ollama, e.g.: `ollama pull llama3.2`
4. Build tools for native modules: `sudo apt install build-essential python3`

## Setup

```bash
npm install    # installs dependencies and rebuilds node-pty for Electron
```

## Run

```bash
npm start
```

## Configuration

Edit `config.yaml` in the project root:

```yaml
llm:
  url: "http://localhost:11434"   # Ollama base URL
  model: "llama3.2"              # Model name (must be pulled)

terminal:
  shell: ""        # Leave empty to use $SHELL env var
  fontSize: 14
  fontFamily: "Cascadia Code, Fira Code, Consolas, monospace"

context:
  maxEntries: 10        # How many recent commands the LLM sees
  maxOutputChars: 2000  # Max chars of output per command stored
```

## How it works

1. Every command you run in the terminal is captured (command + output).
2. The last 10 commands are included as context in the LLM system prompt.
3. When you send a message in the chat, the LLM responds with awareness of your terminal session.
4. The LLM can suggest commands, interpret errors, and explain output.
