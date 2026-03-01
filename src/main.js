'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path   = require('path');
const http   = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

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
const { loadConfig, saveConfig, loadLLMSettings, saveLLMSettings } = require('./configLoader');
const ptyManager = require('./ptyManager');
const contextBuffer = require('./contextBuffer');
const LLMClient = require('./ollamaClient');

let win;
let config;
let llmSettings;
let ollamaClient;
let pendingOAuth = null; // { server } — for cleanup on retry
let pendingGeminiOAuth = null; // { server } — for cleanup on retry
let ptyOutputHandler = null;
let ptyExitHandler = null;
let autoCommentTimer = null;
let lastAutoEntryCount = 0;
let autoFinalizeTimer = null;

// ---- OpenAI Codex OAuth constants ----
const CODEX_CLIENT_ID   = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_AUTH_URL    = 'https://auth.openai.com/oauth/authorize';
const CODEX_TOKEN_URL   = 'https://auth.openai.com/oauth/token';
const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const CODEX_SCOPES      = 'openid profile email offline_access';
const CODEX_PORT        = 1455;
const CODEX_BACKEND_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com';
const GEMINI_AUTH_URL   = 'https://accounts.google.com/o/oauth2/v2/auth';
const GEMINI_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const GEMINI_REDIRECT_URI = 'http://127.0.0.1:1456/auth/callback';
const GEMINI_SCOPES     = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language.retriever';
const GEMINI_PORT       = 1456;

// ---- PKCE helpers ----
function generateCodeVerifier()   { return crypto.randomBytes(32).toString('base64url'); }
function generateCodeChallenge(v) { return crypto.createHash('sha256').update(v).digest('base64url'); }
function generateState()          { return crypto.randomBytes(16).toString('hex'); }

// ---- Built-in default system prompt ----
// NOTE: This string is also duplicated in src/renderer/settingsManager.js
// (_getBuiltinDefaultPrompt) so the Reset button works without an IPC round-trip.
// Keep both in sync if you change this.
const BASE_SYSTEM_PROMPT = [
  'You are an intelligent terminal assistant embedded in SmartShell, a split-pane terminal + AI application.',
  'You have visibility into the user\'s recent terminal session and can help them interpret command output,',
  'diagnose errors, suggest next commands, and explain what\'s happening in their shell.',
  '',
  'Guidelines:',
  '- When suggesting shell commands, wrap them in backticks: `command here`',
  '- Prefix runnable commands with [runnable] and examples/placeholders with [example]',
  '- Only wrap full runnable commands in backticks; do not backtick filenames, paths, hostnames, or output values',
  '- If the terminal output shows an error, diagnose it directly and suggest a fix',
  '- Keep responses concise — the user is in an active terminal workflow',
  '- You may reference specific lines or values from the terminal output'
].join('\n');

function normalizeCommandPolicy(policy) {
  const mode = policy && typeof policy.runMode === 'string' ? policy.runMode : 'balanced';
  const allowedMode = new Set(['strict', 'balanced', 'permissive']).has(mode) ? mode : 'balanced';
  const asList = (value) => {
    if (!Array.isArray(value)) return [];
    return value
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, 200);
  };
  return {
    runMode: allowedMode,
    allowlist: asList(policy ? policy.allowlist : []),
    blocklist: asList(policy ? policy.blocklist : [])
  };
}

function precheckCommandSyntax(commandText) {
  const cmd = String(commandText || '').trim();
  if (!cmd) return { ok: false, skipped: false, reason: 'Empty command.' };

  const unbalanced = (char) => (cmd.split(char).length - 1) % 2 !== 0;
  if (unbalanced('"')) return { ok: false, skipped: false, reason: 'Unbalanced double quotes.' };
  if (unbalanced("'")) return { ok: false, skipped: false, reason: 'Unbalanced single quotes.' };
  if (unbalanced('`')) return { ok: false, skipped: false, reason: 'Unbalanced backticks.' };
  if (/[|&]\s*$/.test(cmd)) return { ok: false, skipped: false, reason: 'Command ends with an incomplete operator.' };
  if (/<<\s*$/.test(cmd)) return { ok: false, skipped: false, reason: 'Heredoc operator is incomplete.' };

  const shellExe = config?.terminal?.shell || process.env.SHELL || '/bin/bash';
  if (!/(?:^|\/)(?:bash|zsh|sh)$/.test(shellExe)) {
    return { ok: true, skipped: true, reason: `Syntax parser skipped for shell: ${path.basename(shellExe)}` };
  }

  const parseOnly = spawnSync(shellExe, ['-n', '-c', cmd], { encoding: 'utf8' });
  if (parseOnly.status !== 0) {
    const stderr = (parseOnly.stderr || '').trim();
    return { ok: false, skipped: false, reason: stderr || 'Shell parser rejected command.' };
  }
  return { ok: true, skipped: false, reason: '' };
}

// ---- Codex token refresh ----
// Refreshes the stored access token if it expires within the next 5 minutes.
async function _refreshCodexTokenIfNeeded() {
  if (!llmSettings.openaiRefreshToken) return;
  const FIVE_MIN = 5 * 60 * 1000;
  const expiry   = llmSettings.openaiTokenExpiry;
  if (expiry && Date.now() < expiry - FIVE_MIN) return; // still valid

  try {
    const tokenRes = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     CODEX_CLIENT_ID,
        refresh_token: llmSettings.openaiRefreshToken
      }).toString()
    });

    if (!tokenRes.ok) return; // let chat() surface the auth error naturally

    const data = await tokenRes.json();
    if (data.access_token) {
      llmSettings.openaiAccessToken  = data.access_token;
      llmSettings.openaiRefreshToken = data.refresh_token || llmSettings.openaiRefreshToken;
      llmSettings.openaiTokenExpiry  = data.expires_in ? Date.now() + data.expires_in * 1000 : 0;
      saveLLMSettings(llmSettings);
      ollamaClient = createLLMClientForSource(llmSettings.source, llmSettings.url, llmSettings.model, llmSettings.openaiAccessToken);
    }
  } catch (_) {}
}

// ---- Gemini token refresh ----
// Refreshes the stored Gemini access token if it expires within the next 5 minutes.
async function _refreshGeminiTokenIfNeeded() {
  if (!llmSettings.geminiRefreshToken || !llmSettings.geminiClientId) return;
  const FIVE_MIN = 5 * 60 * 1000;
  const expiry   = llmSettings.geminiTokenExpiry;
  if (expiry && Date.now() < expiry - FIVE_MIN) return; // still valid

  try {
    const tokenRes = await fetch(GEMINI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     llmSettings.geminiClientId,
        refresh_token: llmSettings.geminiRefreshToken
      }).toString()
    });

    if (!tokenRes.ok) return;

    const data = await tokenRes.json();
    if (data.access_token) {
      llmSettings.geminiAccessToken  = data.access_token;
      llmSettings.geminiRefreshToken = data.refresh_token || llmSettings.geminiRefreshToken;
      llmSettings.geminiTokenExpiry  = data.expires_in ? Date.now() + data.expires_in * 1000 : 0;
      saveLLMSettings(llmSettings);
      ollamaClient = createLLMClientForSource(llmSettings.source, llmSettings.url, llmSettings.model, llmSettings.openaiAccessToken);
    }
  } catch (_) {}
}

function _assertGeminiAccessToken() {
  if (!llmSettings.geminiAccessToken) {
    throw new Error('Gemini is not authenticated. Open Settings -> Gemini OAuth, sign in with Google, then try again.');
  }
}

function createLLMClientForSource(source, url, model, openaiToken = null) {
  if (source === 'openai') {
    // ChatGPT OAuth tokens for Codex are served by the ChatGPT Codex backend.
    return new LLMClient(CODEX_BACKEND_BASE_URL, model, openaiToken || null, true, '/responses');
  }
  if (source === 'gemini') {
    return new LLMClient(
      GEMINI_OPENAI_BASE_URL,
      model,
      llmSettings.geminiAccessToken || null,
      false,
      '/v1/responses',
      '/v1beta/openai/chat/completions',
      '/v1beta/openai/models'
    );
  }
  return new LLMClient(url, model, null, false);
}

function getAssistantMode() {
  return (config.assistant && config.assistant.mode) || 'prompted';
}

function _scheduleAutoCommentIfNeeded() {
  if (getAssistantMode() !== 'automatic') return;
  const currentCount = contextBuffer.entries.length;
  if (currentCount === 0 || currentCount <= lastAutoEntryCount) return;
  clearTimeout(autoCommentTimer);
  autoCommentTimer = setTimeout(() => {
    _runAutoCommentForLatest().catch((err) => {
      if (win && !win.isDestroyed()) win.webContents.send('autochat:error', String(err.message || err));
    });
  }, 300);
}

function _scheduleAutoFinalizeFallback() {
  if (getAssistantMode() !== 'automatic') return;
  if (contextBuffer.state !== 'COLLECTING_OUTPUT' || !contextBuffer.pendingCommand) return;

  const marker = contextBuffer.outputAccumulator.length;
  clearTimeout(autoFinalizeTimer);
  autoFinalizeTimer = setTimeout(() => {
    const stillCollecting = contextBuffer.state === 'COLLECTING_OUTPUT' && !!contextBuffer.pendingCommand;
    const unchanged = contextBuffer.outputAccumulator.length === marker;
    if (!stillCollecting || !unchanged) return;

    const beforeCount = contextBuffer.entries.length;
    contextBuffer.flushPending();
    if (contextBuffer.entries.length > beforeCount) {
      _scheduleAutoCommentIfNeeded();
    }
  }, 1200);
}

async function _runAutoCommentForLatest() {
  const entries = contextBuffer.getEntries();
  if (entries.length === 0) return;
  const latest = entries[entries.length - 1];
  const latestIndex = entries.length;
  if (latestIndex <= lastAutoEntryCount) return;

  if (llmSettings.source === 'openai') {
    await _refreshCodexTokenIfNeeded();
  } else if (llmSettings.source === 'gemini') {
    await _refreshGeminiTokenIfNeeded();
    _assertGeminiAccessToken();
  }

  lastAutoEntryCount = latestIndex;

  const autoPrompt = [
    'Provide a concise proactive comment on the latest terminal result.',
    'If there is an error, explain the cause and suggest one next command.',
    'If successful, summarize what happened in 1-2 sentences.'
  ].join(' ');

  contextBuffer.flushPending();
  const systemPrompt = buildSystemPrompt();

  if (win && !win.isDestroyed()) {
    win.webContents.send('autochat:start', { command: latest.command || '' });
  }

  await ollamaClient.chat(
    systemPrompt,
    autoPrompt,
    (chunk) => {
      if (win && !win.isDestroyed()) win.webContents.send('autochat:chunk', chunk);
    },
    () => {
      if (win && !win.isDestroyed()) win.webContents.send('autochat:done');
    },
    (err) => {
      if (win && !win.isDestroyed()) win.webContents.send('autochat:error', err);
    }
  );
}

function createWindow() {
  config      = loadConfig();
  llmSettings = loadLLMSettings();

  // Apply context settings from config
  contextBuffer.maxEntries     = config.context.maxEntries;
  contextBuffer.maxOutputChars = config.context.maxOutputChars;

  ollamaClient = createLLMClientForSource(
    llmSettings.source,
    llmSettings.url,
    llmSettings.model,
    llmSettings.openaiAccessToken || null
  );

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#1a1a1a',
    title: 'SmartShell',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
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
  const shellExe = config.terminal.shell || process.env.SHELL || '/bin/bash';

  ptyManager.spawn(shellExe, process.env, 80, 24);

  // When the renderer reloads in development, avoid stacking duplicate listeners.
  if (ptyOutputHandler) ptyManager.off('output', ptyOutputHandler);
  if (ptyExitHandler) ptyManager.off('exit', ptyExitHandler);

  // Dual-route PTY output: display + context
  ptyOutputHandler = (data) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('pty:output', data);
    }
    const beforeCount = contextBuffer.entries.length;
    contextBuffer.appendOutput(data);
    if (contextBuffer.entries.length > beforeCount) {
      _scheduleAutoCommentIfNeeded();
    } else {
      _scheduleAutoFinalizeFallback();
    }
  };
  ptyManager.on('output', ptyOutputHandler);

  ptyExitHandler = (exitCode) => {
    console.log(`[main] PTY exited with code ${exitCode}`);
    if (win && !win.isDestroyed()) {
      win.webContents.send('pty:output', '\r\n[Shell exited. Close the window or restart.]\r\n');
    }
  };
  ptyManager.on('exit', ptyExitHandler);
}

// ---- IPC: Terminal input ----
ipcMain.on('pty:input', (_event, data) => {
  const notifyEnterWithAutoCheck = () => {
    const beforeCount = contextBuffer.entries.length;
    contextBuffer.notifyEnter();
    if (contextBuffer.entries.length > beforeCount) {
      _scheduleAutoCommentIfNeeded();
    }
  };

  // Track input for command boundary detection
  if (data === '\r' || data === '\n') {
    notifyEnterWithAutoCheck();
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
        notifyEnterWithAutoCheck();
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
  try {
    if (llmSettings.source === 'openai') {
      await _refreshCodexTokenIfNeeded();
    } else if (llmSettings.source === 'gemini') {
      await _refreshGeminiTokenIfNeeded();
      _assertGeminiAccessToken();
    }

    // Capture any in-flight terminal entry before prompt construction.
    contextBuffer.flushPending();
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
  } catch (err) {
    if (win && !win.isDestroyed()) win.webContents.send('chat:error', err.message || String(err));
  }
});

// ---- IPC: Fetch models from an OpenAI-compatible endpoint ----
ipcMain.handle('llm:fetch-models', async (_event, { url, source }) => {
  try {
    if (source === 'openai') return { error: 'OpenAI model discovery is not supported in-app.' };
    let client;
    if (source === 'gemini') {
      await _refreshGeminiTokenIfNeeded();
      _assertGeminiAccessToken();
      client = new LLMClient(
        GEMINI_OPENAI_BASE_URL,
        '',
        llmSettings.geminiAccessToken,
        false,
        '/v1/responses',
        '/v1beta/openai/chat/completions',
        '/v1beta/openai/models'
      );
    } else {
      client = new LLMClient(url, '', null);
    }
    const models = await client.fetchModels();
    return { models };
  } catch (err) {
    return { error: err.message };
  }
});

// ---- IPC: Save LLM config and reinitialise client ----
ipcMain.handle('llm:save-config', (_event, payload) => {
  // payload: { source, systemPrompt, url?, model }
  try {
    llmSettings.source  = payload.source;
    config.systemPrompt = payload.systemPrompt || '';
    if (payload.commandPolicy) {
      config.commandPolicy = normalizeCommandPolicy(payload.commandPolicy);
    }

    if (payload.source === 'local') {
      llmSettings.url   = payload.url;
      llmSettings.model = payload.model;
      ollamaClient = createLLMClientForSource('local', payload.url, payload.model, null);
    } else if (payload.source === 'gemini') {
      const clientId = (payload.clientId || '').trim();
      if (clientId) llmSettings.geminiClientId = clientId;
      if (!llmSettings.geminiClientId) return { error: 'Gemini OAuth Client ID is required.' };
      if (!llmSettings.geminiAccessToken) return { error: 'Sign in to Gemini first.' };
      llmSettings.model = payload.model;
      ollamaClient = createLLMClientForSource('gemini', llmSettings.url, payload.model, null);
    } else {
      // openai (Codex)
      llmSettings.model = payload.model;
      ollamaClient = createLLMClientForSource('openai', llmSettings.url, payload.model, llmSettings.openaiAccessToken || null);
    }

    saveLLMSettings(llmSettings);
    saveConfig(config);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ---- IPC: Get config ----
ipcMain.handle('config:get', () => {
  return {
    llm: {
      url:             llmSettings.url,
      model:           llmSettings.model,
      source:          llmSettings.source          || 'local',
      openaiConnected: !!(llmSettings.openaiAccessToken),
      geminiConnected: !!(llmSettings.geminiAccessToken),
      geminiClientId:  llmSettings.geminiClientId || ''
      // tokens are never sent to the renderer
    },
    terminal:     config.terminal,
    context:      config.context,
    assistant:    config.assistant,
    commandPolicy: normalizeCommandPolicy(config.commandPolicy || {}),
    systemPrompt: config.systemPrompt || ''
  };
});

ipcMain.handle('command:precheck', (_event, commandText) => {
  try {
    return precheckCommandSyntax(commandText);
  } catch (err) {
    return { ok: false, skipped: false, reason: err.message || String(err) };
  }
});

// ---- IPC: Assistant behavior mode ----
ipcMain.handle('assistant:set-mode', (_event, mode) => {
  const allowed = new Set(['prompted', 'automatic', 'autorun']);
  if (!allowed.has(mode)) return { error: 'Invalid assistant mode.' };
  config.assistant = config.assistant || {};
  config.assistant.mode = mode;
  saveConfig(config);
  if (mode !== 'automatic') {
    clearTimeout(autoCommentTimer);
    clearTimeout(autoFinalizeTimer);
  } else {
    _scheduleAutoFinalizeFallback();
    _scheduleAutoCommentIfNeeded();
  }
  return { ok: true, mode };
});

// ---- IPC: Clear terminal context window ----
ipcMain.handle('context:clear', () => {
  try {
    const clearedEntries = contextBuffer.entries.length;
    contextBuffer.clear();
    lastAutoEntryCount = 0;
    clearTimeout(autoCommentTimer);
    clearTimeout(autoFinalizeTimer);
    return { ok: true, clearedEntries, remainingEntries: contextBuffer.entries.length };
  } catch (err) {
    return { error: err.message };
  }
});

// ---- IPC: Start OpenAI Codex OAuth 2.0 + PKCE flow ----
ipcMain.handle('openai:start-oauth', async (_event) => {
  // Clean up any previous pending OAuth server
  if (pendingOAuth && pendingOAuth.server) {
    try { pendingOAuth.server.close(); } catch (_) {}
    pendingOAuth = null;
  }

  const verifier  = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state     = generateState();

  // Start one-shot local HTTP server on fixed port 1455 (required by Codex OAuth registration)
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const srv = http.createServer();
      srv.listen(CODEX_PORT, '127.0.0.1', () => resolve(srv));
      srv.on('error', reject);
    });
  } catch (err) {
    return { error: `Failed to start local callback server on port ${CODEX_PORT}: ${err.message}. Is another instance running?` };
  }

  pendingOAuth = { server };

  const authParams = new URLSearchParams({
    response_type:         'code',
    client_id:             CODEX_CLIENT_ID,
    redirect_uri:          CODEX_REDIRECT_URI,
    scope:                 CODEX_SCOPES,
    codex_cli_simplified_flow: 'true',
    id_token_add_organizations: 'true',
    state:                 state,
    code_challenge:        challenge,
    code_challenge_method: 'S256'
  });
  const authUrl = `${CODEX_AUTH_URL}?${authParams.toString()}`;

  const result = await new Promise((resolve) => {
    server.on('request', async (req, res) => {
      let reqUrl;
      try {
        reqUrl = new URL(req.url, `http://127.0.0.1:${CODEX_PORT}`);
      } catch (_) {
        res.writeHead(400); res.end(); return;
      }

      if (reqUrl.pathname !== '/auth/callback') {
        res.writeHead(404); res.end(); return;
      }

      const returnedState = reqUrl.searchParams.get('state');
      const code          = reqUrl.searchParams.get('code');
      const errorParam    = reqUrl.searchParams.get('error');

      // Respond so the browser tab can close cleanly
      const msg  = errorParam
        ? 'Authentication failed. You may close this tab.'
        : 'Authentication complete! You may close this tab.';
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>` +
        `<body style="font-family:sans-serif;padding:40px;background:#1a1a1a;color:#d4d4d4">` +
        `<h2 style="color:#4ec9b0">SmartShell</h2><p>${msg}</p></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);

      server.close();
      pendingOAuth = null;

      if (errorParam)              { resolve({ error: `OAuth error: ${errorParam}` }); return; }
      if (returnedState !== state) { resolve({ error: 'OAuth state mismatch — possible CSRF.' }); return; }
      if (!code)                   { resolve({ error: 'No authorization code received.' }); return; }

      // Exchange the authorization code for tokens
      try {
        const tokenRes = await fetch(CODEX_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type:    'authorization_code',
            client_id:     CODEX_CLIENT_ID,
            code:          code,
            redirect_uri:  CODEX_REDIRECT_URI,
            code_verifier: verifier
          }).toString()
        });

        if (!tokenRes.ok) {
          const detail = await tokenRes.text().catch(() => '');
          resolve({ error: `Token exchange failed (HTTP ${tokenRes.status}): ${detail}` });
          return;
        }

        const tokenData    = await tokenRes.json();
        const accessToken  = tokenData.access_token;
        const refreshToken = tokenData.refresh_token || '';
        const expiresIn    = tokenData.expires_in    || 0;

        if (!accessToken) {
          resolve({ error: 'Token response did not include access_token.' });
          return;
        }

        llmSettings.openaiAccessToken  = accessToken;
        llmSettings.openaiRefreshToken = refreshToken;
        llmSettings.openaiTokenExpiry  = expiresIn ? Date.now() + expiresIn * 1000 : 0;
        saveLLMSettings(llmSettings);

        ollamaClient = createLLMClientForSource('openai', llmSettings.url, llmSettings.model, llmSettings.openaiAccessToken);
        resolve({ ok: true });
      } catch (fetchErr) {
        resolve({ error: `Token exchange request failed: ${fetchErr.message}` });
      }
    });

    // Open browser to authorization URL
    shell.openExternal(authUrl);
  });

  return result;
});

// ---- IPC: Disconnect from OpenAI Codex (revoke stored tokens) ----
ipcMain.handle('openai:disconnect', (_event) => {
  try {
    llmSettings.openaiAccessToken  = '';
    llmSettings.openaiRefreshToken = '';
    llmSettings.openaiTokenExpiry  = 0;
    saveLLMSettings(llmSettings);
    ollamaClient = createLLMClientForSource('openai', llmSettings.url, llmSettings.model, null);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ---- IPC: Start Gemini OAuth 2.0 + PKCE flow ----
ipcMain.handle('gemini:start-oauth', async (_event, { clientId }) => {
  const effectiveClientId = (clientId || '').trim() || (llmSettings.geminiClientId || '').trim();
  if (!effectiveClientId) return { error: 'Gemini OAuth Client ID is required.' };

  if (pendingGeminiOAuth && pendingGeminiOAuth.server) {
    try { pendingGeminiOAuth.server.close(); } catch (_) {}
    pendingGeminiOAuth = null;
  }

  const verifier  = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state     = generateState();

  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const srv = http.createServer();
      srv.listen(GEMINI_PORT, '127.0.0.1', () => resolve(srv));
      srv.on('error', reject);
    });
  } catch (err) {
    return { error: `Failed to start local callback server on port ${GEMINI_PORT}: ${err.message}. Is another instance running?` };
  }

  pendingGeminiOAuth = { server };

  const authParams = new URLSearchParams({
    response_type:         'code',
    client_id:             effectiveClientId,
    redirect_uri:          GEMINI_REDIRECT_URI,
    scope:                 GEMINI_SCOPES,
    access_type:           'offline',
    prompt:                'consent',
    state:                 state,
    code_challenge:        challenge,
    code_challenge_method: 'S256'
  });
  const authUrl = `${GEMINI_AUTH_URL}?${authParams.toString()}`;

  const result = await new Promise((resolve) => {
    server.on('request', async (req, res) => {
      let reqUrl;
      try {
        reqUrl = new URL(req.url, `http://127.0.0.1:${GEMINI_PORT}`);
      } catch (_) {
        res.writeHead(400); res.end(); return;
      }

      if (reqUrl.pathname !== '/auth/callback') {
        res.writeHead(404); res.end(); return;
      }

      const returnedState = reqUrl.searchParams.get('state');
      const code          = reqUrl.searchParams.get('code');
      const errorParam    = reqUrl.searchParams.get('error');

      const msg  = errorParam
        ? 'Authentication failed. You may close this tab.'
        : 'Authentication complete! You may close this tab.';
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>` +
        `<body style="font-family:sans-serif;padding:40px;background:#1a1a1a;color:#d4d4d4">` +
        `<h2 style="color:#4ec9b0">SmartShell</h2><p>${msg}</p></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);

      server.close();
      pendingGeminiOAuth = null;

      if (errorParam)              { resolve({ error: `OAuth error: ${errorParam}` }); return; }
      if (returnedState !== state) { resolve({ error: 'OAuth state mismatch — possible CSRF.' }); return; }
      if (!code)                   { resolve({ error: 'No authorization code received.' }); return; }

      try {
        const tokenRes = await fetch(GEMINI_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type:    'authorization_code',
            client_id:     effectiveClientId,
            code:          code,
            redirect_uri:  GEMINI_REDIRECT_URI,
            code_verifier: verifier
          }).toString()
        });

        if (!tokenRes.ok) {
          const detail = await tokenRes.text().catch(() => '');
          resolve({ error: `Token exchange failed (HTTP ${tokenRes.status}): ${detail}` });
          return;
        }

        const tokenData    = await tokenRes.json();
        const accessToken  = tokenData.access_token;
        const refreshToken = tokenData.refresh_token || '';
        const expiresIn    = tokenData.expires_in    || 0;

        if (!accessToken) {
          resolve({ error: 'Token response did not include access_token.' });
          return;
        }

        llmSettings.geminiClientId     = effectiveClientId;
        llmSettings.geminiAccessToken  = accessToken;
        llmSettings.geminiRefreshToken = refreshToken;
        llmSettings.geminiTokenExpiry  = expiresIn ? Date.now() + expiresIn * 1000 : 0;
        saveLLMSettings(llmSettings);

        if (llmSettings.source === 'gemini') {
          ollamaClient = createLLMClientForSource('gemini', llmSettings.url, llmSettings.model, null);
        }
        resolve({ ok: true });
      } catch (fetchErr) {
        resolve({ error: `Token exchange request failed: ${fetchErr.message}` });
      }
    });

    shell.openExternal(authUrl);
  });

  return result;
});

// ---- IPC: Disconnect from Gemini OAuth ----
ipcMain.handle('gemini:disconnect', () => {
  try {
    llmSettings.geminiAccessToken  = '';
    llmSettings.geminiRefreshToken = '';
    llmSettings.geminiTokenExpiry  = 0;
    saveLLMSettings(llmSettings);
    if (llmSettings.source === 'gemini') {
      ollamaClient = createLLMClientForSource('gemini', llmSettings.url, llmSettings.model, null);
    }
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

function buildSystemPrompt() {
  const terminalContext = contextBuffer.serialize();
  const entryCount      = contextBuffer.entries.length;

  const basePrompt = (config.systemPrompt && config.systemPrompt.trim())
    ? config.systemPrompt.trim()
    : BASE_SYSTEM_PROMPT;

  const sections = [
    basePrompt,
    '',
    `## Recent Terminal Activity (${entryCount} command${entryCount !== 1 ? 's' : ''})`
  ];

  if (entryCount === 0) {
    sections.push(
      '',
      'Terminal context is currently empty (it may have been cleared).',
      'Do not claim you can see prior commands. If asked about earlier results, ask the user to run the command again.',
      '',
      terminalContext
    );
  } else {
    sections.push('', terminalContext);
  }

  return sections.join('\n');
}

// ---- App lifecycle ----
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (pendingOAuth && pendingOAuth.server) {
    try { pendingOAuth.server.close(); } catch (_) {}
  }
  if (pendingGeminiOAuth && pendingGeminiOAuth.server) {
    try { pendingGeminiOAuth.server.close(); } catch (_) {}
  }
  ptyManager.destroy();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
