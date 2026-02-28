'use strict';

const { ipcRenderer } = require('electron');
const TerminalManager = require('./terminalManager');
const ChatManager = require('./chatManager');
const SettingsManager = require('./settingsManager');

async function init() {
  // Fetch config from main process
  const config = await ipcRenderer.invoke('config:get');

  // Show model name in header
  const modelLabel = document.getElementById('model-label');
  if (modelLabel) modelLabel.textContent = config.llm.model;

  // Initialize terminal
  const termContainer = document.getElementById('terminal-container');
  const termMgr = new TerminalManager(config);
  termMgr.init(termContainer);

  // Initialize chat
  new ChatManager();

  // Initialize assistant behavior controls
  initAssistantModeControls(config);

  // Initialize settings panel
  const toggleBtn = document.getElementById('settings-toggle-btn');
  const settingsMgr = new SettingsManager((source, url, model) => {
    // Update model badge and cached config after save
    config.llm.source = source;
    config.llm.url    = url || config.llm.url;
    config.llm.model  = model;
    if (modelLabel) modelLabel.textContent = model;
    toggleBtn.classList.remove('active');
  });

  toggleBtn.addEventListener('click', () => {
    if (settingsMgr.isOpen()) {
      settingsMgr.close();
      toggleBtn.classList.remove('active');
    } else {
      settingsMgr.open(config); // pass full config snapshot
      toggleBtn.classList.add('active');
    }
  });

  // Initialize drag-to-resize handle
  initResizeHandle(termMgr);

  // Click on terminal pane focuses the terminal
  document.getElementById('terminal-pane').addEventListener('click', () => {
    termMgr.focus();
  });
}

function initAssistantModeControls(config) {
  const selectEl = document.getElementById('assistant-mode-select');
  const noteEl = document.getElementById('assistant-mode-note');
  if (!selectEl || !noteEl) return;

  const applyNote = (mode) => {
    if (mode === 'autorun') {
      noteEl.textContent = 'Auto-run commands is not implemented yet.';
      noteEl.classList.add('warn');
    } else if (mode === 'automatic') {
      noteEl.textContent = 'Assistant will proactively comment on terminal results.';
      noteEl.classList.remove('warn');
    } else {
      noteEl.textContent = '';
      noteEl.classList.remove('warn');
    }
  };

  let currentMode = (config.assistant && config.assistant.mode) || 'prompted';
  selectEl.value = currentMode;
  applyNote(currentMode);

  selectEl.addEventListener('change', async () => {
    const requestedMode = selectEl.value;
    const result = await ipcRenderer.invoke('assistant:set-mode', requestedMode);
    if (result.error) {
      applyNote(currentMode);
      selectEl.value = currentMode;
      return;
    }
    config.assistant = config.assistant || {};
    config.assistant.mode = requestedMode;
    currentMode = requestedMode;
    applyNote(requestedMode);
  });
}

function initResizeHandle(termMgr) {
  const handle    = document.getElementById('resize-handle');
  const termPane  = document.getElementById('terminal-pane');
  const appEl     = document.getElementById('app');

  let dragging   = false;
  let startX     = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    dragging    = true;
    startX      = e.clientX;
    startWidth  = termPane.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    // Prevent the terminal from stealing mouse events during drag
    document.getElementById('terminal-container').style.pointerEvents = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const appWidth = appEl.getBoundingClientRect().width;
    const HANDLE_WIDTH = 4;
    const MIN_PANE = 200;
    const newWidth = Math.min(
      Math.max(startWidth + (e.clientX - startX), MIN_PANE),
      appWidth - MIN_PANE - HANDLE_WIDTH
    );
    termPane.style.flex = `0 0 ${newWidth}px`;
    // ResizeObserver in TerminalManager will fire and call fitToContainer
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.getElementById('terminal-container').style.pointerEvents = '';
    // Explicitly re-fit after drag ends
    termMgr.fitToContainer();
    termMgr.focus();
  });
}

// Boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
