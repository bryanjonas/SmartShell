'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function startDevWatcher() {
  const fs = require('fs');
  let debounce = null;
  fs.watch(__dirname, { recursive: true }, (_, filename) => {
    if (!filename || filename.includes('node_modules')) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (win && !win.isDestroyed()) win.webContents.reload();
    }, 150);
  });
}
const { loadConfig, saveConfig } = require('./configLoader');
const ptyManager = require('./ptyManager');
const contextBuffer = require('./contextBuffer');
const LLMClient = require('./ollamaClient');

let win;
let config;
let ollamaClient;

function createWindow() {
  config = loadConfig();

  // Apply context settings from config
  contextBuffer.maxEntries = config.context.maxEntries;
  contextBuffer.maxOutputChars = config.context.maxOutputChars;

  ollamaClient = new LLMClient(config.llm.url, config.llm.model);

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#1a1a1a',
    title: 'SmartShell',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools({ mode: 'detach' });
    startDevWatcher();
  }

  win.webContents.on('did-finish-load', () => {
    startPty();
  });

  win.on('closed', () => {
    win = null;
  });
}

function startPty() {
  const shell = config.terminal.shell || process.env.SHELL || '/bin/bash';

  ptyManager.spawn(shell, process.env, 80, 24);

  // Dual-route PTY output: display + context
  ptyManager.on('output', (data) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pty:output', data);
    }
    contextBuffer.appendOutput(data);
  });

  ptyManager.on('exit', (exitCode) => {
    console.log(`[main] PTY exited with code ${exitCode}`);
    if (win && !win.isDestroyed()) {
      win.webContents.send('pty:output', '\r\n[Shell exited. Close the window or restart.]\r\n');
    }
  });
}

// ---- IPC: Terminal input ----
ipcMain.on('pty:input', (_event, data) => {
  // Track input for command boundary detection
  if (data === '\r' || data === '\n') {
    contextBuffer.notifyEnter();
  } else if (data === '\x7f' || data === '\x08') {
    // Backspace
    if (contextBuffer.inputAccumulator.length > 0) {
      contextBuffer.inputAccumulator = contextBuffer.inputAccumulator.slice(0, -1);
    }
  } else if (data === '\x15') {
    // Ctrl+U (kill line)
    contextBuffer.inputAccumulator = '';
  } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
    // Printable character
    contextBuffer.inputAccumulator += data;
  } else if (data.length > 1) {
    // Pasted text — handle embedded Enter
    for (const char of data) {
      if (char === '\r' || char === '\n') {
        contextBuffer.notifyEnter();
      } else if (char.charCodeAt(0) >= 32) {
        contextBuffer.inputAccumulator += char;
      }
    }
  }

  ptyManager.write(data);
});

// ---- IPC: Terminal resize ----
ipcMain.on('pty:resize', (_event, cols, rows) => {
  ptyManager.resize(cols, rows);
});

// ---- IPC: Chat message ----
ipcMain.on('chat:send', async (_event, userMessage) => {
  const systemPrompt = buildSystemPrompt();

  await ollamaClient.chat(
    systemPrompt,
    userMessage,
    (chunk) => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:chunk', chunk);
    },
    () => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:done');
    },
    (err) => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:error', err);
    }
  );
});

// ---- IPC: Fetch models from an OpenAI-compatible endpoint ----
ipcMain.handle('llm:fetch-models', async (_event, { url }) => {
  try {
    const client = new LLMClient(url, '');
    const models = await client.fetchModels();
    return { models };
  } catch (err) {
    return { error: err.message };
  }
});

// ---- IPC: Save LLM config and reinitialise client ----
ipcMain.handle('llm:save-config', (_event, { url, model }) => {
  try {
    config.llm.url = url;
    config.llm.model = model;
    saveConfig(config);
    ollamaClient = new LLMClient(url, model);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ---- IPC: Get config ----
ipcMain.handle('config:get', () => {
  return {
    llm: { model: config.llm.model, url: config.llm.url },
    terminal: config.terminal,
    context: config.context
  };
});

function buildSystemPrompt() {
  const terminalContext = contextBuffer.serialize();
  const entryCount = contextBuffer.entries.length;

  return [
    'You are an intelligent terminal assistant embedded in SmartShell, a split-pane terminal + AI application.',
    'You have visibility into the user\'s recent terminal session and can help them interpret command output,',
    'diagnose errors, suggest next commands, and explain what\'s happening in their shell.',
    '',
    'Guidelines:',
    '- When suggesting shell commands, wrap them in backticks: `command here`',
    '- If the terminal output shows an error, diagnose it directly and suggest a fix',
    '- Keep responses concise — the user is in an active terminal workflow',
    '- You may reference specific lines or values from the terminal output',
    '',
    `## Recent Terminal Activity (${entryCount} command${entryCount !== 1 ? 's' : ''})`,
    '',
    terminalContext
  ].join('\n');
}

// ---- App lifecycle ----
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  ptyManager.destroy();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
