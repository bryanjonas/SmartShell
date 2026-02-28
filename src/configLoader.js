'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULTS = {
  llm: {
    url: 'http://localhost:11434',
    model: 'llama3.2'
  },
  terminal: {
    shell: '',
    fontSize: 14,
    fontFamily: 'Cascadia Code, Fira Code, Consolas, monospace'
  },
  context: {
    maxEntries: 10,
    maxOutputChars: 2000
  }
};

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined && source[key] !== null) {
      result[key] = source[key];
    }
  }
  return result;
}

function loadConfig() {
  // Look for config.yaml in the project root (next to package.json)
  const projectRoot = path.join(__dirname, '..');
  const configPath = path.join(projectRoot, 'config.yaml');

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

function saveConfig(config) {
  const projectRoot = path.join(__dirname, '..');
  const configPath = path.join(projectRoot, 'config.yaml');
  fs.writeFileSync(configPath, yaml.dump(config), 'utf8');
}

module.exports = { loadConfig, saveConfig };
