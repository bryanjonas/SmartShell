'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Settings that live in config.yaml — manually editable by the user.
const DEFAULTS = {
  terminal: {
    shell:      '',
    fontSize:   14,
    fontFamily: 'Cascadia Code, Fira Code, Consolas, monospace'
  },
  context: {
    maxEntries:    10,
    maxOutputChars: 2000
  },
  assistant: {
    mode: 'prompted' // 'prompted' | 'automatic' | 'autorun'
  },
  commandPolicy: {
    runMode: 'balanced', // 'strict' | 'balanced' | 'permissive'
    allowlist: [],
    blocklist: []
  },
  systemPrompt: [
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
  ].join('\n')
};

// LLM settings managed by the in-app settings panel.
// Stored in app.getPath('userData')/llm-settings.json — never in the repo.
const LLM_DEFAULTS = {
  source:             'local', // 'local' | 'openai' | 'gemini'
  url:                'http://localhost:11434',
  model:              'llama3.2',
  openaiAccessToken:  '',
  openaiRefreshToken: '',
  openaiTokenExpiry:  0,   // unix ms; 0 = unknown
  geminiClientId:     '',
  geminiAccessToken:  '',
  geminiRefreshToken: '',
  geminiTokenExpiry:  0
};

// Merges source into target, but only for keys already present in target.
// This prevents unknown keys in config.yaml from polluting the config object.
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  const result = { ...target };
  for (const key of Object.keys(target)) {
    if (!(key in source)) continue;
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined && source[key] !== null) {
      result[key] = source[key];
    }
  }
  return result;
}

function loadConfig() {
  const projectRoot = path.join(__dirname, '..');
  const configPath  = path.join(projectRoot, 'config.yaml');

  if (fs.existsSync(configPath)) {
    try {
      const raw = yaml.load(fs.readFileSync(configPath, 'utf8'));
      return deepMerge(DEFAULTS, raw || {});
    } catch (err) {
      console.error(`[configLoader] Failed to parse ${configPath}:`, err.message);
    }
  } else {
    console.warn('[configLoader] config.yaml not found, using defaults');
  }

  return { ...DEFAULTS };
}

// Writes only the config.yaml fields back — never touches LLM settings.
function saveConfig(config) {
  const projectRoot = path.join(__dirname, '..');
  const configPath  = path.join(projectRoot, 'config.yaml');
  const toWrite = {
    terminal:     config.terminal,
    context:      config.context,
    assistant:    config.assistant,
    commandPolicy: config.commandPolicy,
    systemPrompt: config.systemPrompt || ''
  };
  fs.writeFileSync(configPath, yaml.dump(toWrite), 'utf8');
}

function _llmSettingsPath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'llm-settings.json');
}

function loadLLMSettings() {
  const p = _llmSettingsPath();

  if (fs.existsSync(p)) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { ...LLM_DEFAULTS, ...raw };
    } catch (err) {
      console.error('[configLoader] Failed to load llm-settings.json:', err.message);
      return { ...LLM_DEFAULTS };
    }
  }

  // First run after upgrade — migrate any llm: block from config.yaml.
  const projectRoot = path.join(__dirname, '..');
  const configPath  = path.join(projectRoot, 'config.yaml');
  if (fs.existsSync(configPath)) {
    try {
      const raw = yaml.load(fs.readFileSync(configPath, 'utf8'));
      if (raw && raw.llm && typeof raw.llm === 'object') {
        const migrated = { ...LLM_DEFAULTS, ...raw.llm };
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(migrated, null, 2), 'utf8');
        console.log('[configLoader] Migrated llm settings from config.yaml → llm-settings.json');
        return migrated;
      }
    } catch (err) {
      console.error('[configLoader] Migration check failed:', err.message);
    }
  }

  return { ...LLM_DEFAULTS };
}

function saveLLMSettings(settings) {
  try {
    const p = _llmSettingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('[configLoader] Failed to save llm-settings.json:', err.message);
  }
}

module.exports = { loadConfig, saveConfig, loadLLMSettings, saveLLMSettings };
