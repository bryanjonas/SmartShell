'use strict';

const { ipcRenderer } = require('electron');
const OPENAI_DEFAULT_MODEL = 'gpt-5.1-codex-mini';

// NOTE: _getBuiltinDefaultPrompt() duplicates BASE_SYSTEM_PROMPT from src/main.js.
// Keep both in sync if you change the default prompt text.

class SettingsManager {
  constructor(onSaved) {
    this.onSaved = onSaved; // callback(source, url, model) after a successful save

    // Panel
    this.panel = document.getElementById('settings-panel');

    // Source tabs
    this.sourceLocalBtn  = document.getElementById('source-local-btn');
    this.sourceOpenaiBtn = document.getElementById('source-openai-btn');
    this.sourceGeminiBtn = document.getElementById('source-gemini-btn');

    // Source sections
    this.localSection  = document.getElementById('local-section');
    this.openaiSection = document.getElementById('openai-section');
    this.geminiSection = document.getElementById('gemini-section');

    // Local endpoint fields
    this.urlInput         = document.getElementById('settings-url');
    this.fetchBtn         = document.getElementById('settings-fetch-btn');
    this.modelSelectLocal = document.getElementById('settings-model-local');

    // OpenAI Codex auth status
    this.openaiConnectBtn    = document.getElementById('openai-connect-btn');
    this.openaiDisconnectBtn = document.getElementById('openai-disconnect-btn');
    this.openaiAuthStatus    = document.getElementById('openai-auth-status');
    this.openaiAuthText      = document.getElementById('openai-auth-text');

    // OpenAI Codex model
    this.openaiModelSelect = document.getElementById('settings-model-openai');

    // Gemini section
    this.geminiKeyInput     = document.getElementById('settings-gemini-key');
    this.geminiModelSelect  = document.getElementById('settings-model-gemini');
    this.geminiFetchBtn     = document.getElementById('settings-fetch-gemini-btn');

    // System prompt
    this.systemPromptTextarea = document.getElementById('settings-system-prompt');
    this.promptResetBtn       = document.getElementById('prompt-reset-btn');

    // Shared actions
    this.statusEl  = document.getElementById('settings-status');
    this.cancelBtn = document.getElementById('settings-cancel-btn');
    this.saveBtn   = document.getElementById('settings-save-btn');

    // Internal state
    this._currentSource   = 'local';
    this._openaiConnected = false;
    this._geminiHasKey    = false;

    this._bindEvents();
  }

  isOpen() {
    return !this.panel.classList.contains('hidden');
  }

  // config = { llm: { source, url, model, openaiConnected }, systemPrompt }
  open(config) {
    this._currentSource   = config.llm.source        || 'local';
    this._openaiConnected = config.llm.openaiConnected || false;
    this._geminiHasKey    = config.llm.geminiHasKey || false;

    // Populate local section
    this.urlInput.value = config.llm.url || '';
    this._resetSelect(this.modelSelectLocal, config.llm.source === 'local' ? config.llm.model : '');

    // Populate OpenAI Codex section
    this._updateOpenAIAuthUI(this._openaiConnected);

    // Populate Gemini section
    this.geminiKeyInput.value = '';
    this._resetSelect(this.geminiModelSelect, '');

    // OpenAI model: keep current selection only if it's in the curated list.
    // Older saved values (e.g. gpt-4o-mini) are forced to the current default.
    if (config.llm.source === 'openai' && config.llm.model) {
      const existing = this.openaiModelSelect.querySelector(`option[value="${config.llm.model}"]`);
      if (existing) {
        this.openaiModelSelect.value = config.llm.model;
      } else {
        this.openaiModelSelect.value = OPENAI_DEFAULT_MODEL;
      }
    } else if (config.llm.source === 'openai') {
      this.openaiModelSelect.value = OPENAI_DEFAULT_MODEL;
    }

    // Always show effective instructions in the panel.
    // If no custom prompt is saved, display the built-in default.
    this.systemPromptTextarea.value = (config.systemPrompt && config.systemPrompt.trim())
      ? config.systemPrompt
      : this._getBuiltinDefaultPrompt();

    // Show correct source section
    this._switchSource(this._currentSource);

    this._setStatus('');
    this.panel.classList.remove('hidden');
    if (this._currentSource === 'local') {
      this.urlInput.focus();
    } else if (this._currentSource === 'gemini') {
      this.geminiKeyInput.focus();
    }
  }

  close() {
    this.panel.classList.add('hidden');
  }

  // ---- Private helpers ----

  _switchSource(source) {
    this._currentSource = source;
    this.sourceLocalBtn.classList.toggle('active',  source === 'local');
    this.sourceOpenaiBtn.classList.toggle('active', source === 'openai');
    this.sourceGeminiBtn.classList.toggle('active', source === 'gemini');
    this.localSection.classList.toggle('hidden',  source !== 'local');
    this.openaiSection.classList.toggle('hidden', source !== 'openai');
    this.geminiSection.classList.toggle('hidden', source !== 'gemini');
  }

  _updateOpenAIAuthUI(connected) {
    this._openaiConnected = connected;
    this.openaiAuthStatus.classList.toggle('connected',    connected);
    this.openaiAuthStatus.classList.toggle('disconnected', !connected);
    this.openaiAuthText.textContent = connected ? 'Signed in' : 'Not signed in';
    this.openaiConnectBtn.classList.toggle('hidden',    connected);
    this.openaiDisconnectBtn.classList.toggle('hidden', !connected);
  }

  _resetSelect(selectEl, currentModel) {
    selectEl.innerHTML = '';
    if (currentModel) {
      const opt = document.createElement('option');
      opt.value = currentModel;
      opt.textContent = currentModel;
      selectEl.appendChild(opt);
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— fetch models first —';
      selectEl.appendChild(opt);
    }
  }

  _populateSelect(selectEl, models, prev) {
    selectEl.innerHTML = '';
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      selectEl.appendChild(opt);
    }
    if (prev && models.includes(prev)) {
      selectEl.value = prev;
    }
  }

  // Returns the built-in default system prompt (duplicated from main.js BASE_SYSTEM_PROMPT).
  _getBuiltinDefaultPrompt() {
    return [
      'You are an intelligent terminal assistant embedded in SmartShell, a split-pane terminal + AI application.',
      'You have visibility into the user\'s recent terminal session and can help them interpret command output,',
      'diagnose errors, suggest next commands, and explain what\'s happening in their shell.',
      '',
      'Guidelines:',
      '- When suggesting shell commands, wrap them in backticks: `command here`',
      '- If the terminal output shows an error, diagnose it directly and suggest a fix',
      '- Keep responses concise — the user is in an active terminal workflow',
      '- You may reference specific lines or values from the terminal output'
    ].join('\n');
  }

  _bindEvents() {
    // Source tabs
    this.sourceLocalBtn.addEventListener('click',  () => this._switchSource('local'));
    this.sourceOpenaiBtn.addEventListener('click', () => this._switchSource('openai'));
    this.sourceGeminiBtn.addEventListener('click', () => this._switchSource('gemini'));

    // Cancel
    this.cancelBtn.addEventListener('click', () => this.close());

    // Reset system prompt to built-in default
    this.promptResetBtn.addEventListener('click', () => {
      this.systemPromptTextarea.value = this._getBuiltinDefaultPrompt();
    });

    // ── LOCAL: Fetch Models ──
    this.fetchBtn.addEventListener('click', async () => {
      const url = this.urlInput.value.trim();
      if (!url) { this._setStatus('Enter a server URL first.', 'error'); return; }

      this.fetchBtn.disabled = true;
      this.fetchBtn.textContent = 'Fetching…';
      this._setStatus('');

      const result = await ipcRenderer.invoke('llm:fetch-models', { url, source: 'local' });

      this.fetchBtn.disabled = false;
      this.fetchBtn.textContent = 'Fetch Models';

      if (result.error) { this._setStatus(`Error: ${result.error}`, 'error'); return; }

      const prev = this.modelSelectLocal.value;
      this._populateSelect(this.modelSelectLocal, result.models, prev);
      this._setStatus(`${result.models.length} model(s) found`, 'ok');
    });

    // ── OPENAI CODEX: Sign in (OAuth PKCE) ──
    this.openaiConnectBtn.addEventListener('click', async () => {
      this.openaiConnectBtn.disabled = true;
      this.openaiConnectBtn.textContent = 'Opening browser…';
      this._setStatus('Complete sign-in in the browser window that just opened.', '');

      const oauthResult = await ipcRenderer.invoke('openai:start-oauth');

      this.openaiConnectBtn.disabled = false;
      this.openaiConnectBtn.textContent = 'Sign in with OpenAI';

      if (oauthResult.error) {
        this._setStatus(`Sign-in failed: ${oauthResult.error}`, 'error');
        return;
      }

      this._updateOpenAIAuthUI(true);
      this._setStatus('Signed in to OpenAI.', 'ok');
    });

    // ── OPENAI CODEX: Sign out ──
    this.openaiDisconnectBtn.addEventListener('click', async () => {
      this.openaiDisconnectBtn.disabled = true;
      const result = await ipcRenderer.invoke('openai:disconnect');
      this.openaiDisconnectBtn.disabled = false;

      if (result.error) { this._setStatus(`Sign-out failed: ${result.error}`, 'error'); return; }

      this._updateOpenAIAuthUI(false);
      this._setStatus('Signed out from OpenAI.', 'ok');
    });

    // ── GEMINI: Fetch Models ──
    this.geminiFetchBtn.addEventListener('click', async () => {
      const enteredKey = this.geminiKeyInput.value.trim();
      const effectiveKey = enteredKey || (this._geminiHasKey ? '__saved__' : '');
      if (!effectiveKey) { this._setStatus('Enter a Gemini API key first.', 'error'); return; }

      this.geminiFetchBtn.disabled = true;
      this.geminiFetchBtn.textContent = 'Fetching…';
      this._setStatus('');

      const result = await ipcRenderer.invoke('llm:fetch-models', {
        source: 'gemini',
        apiKey: enteredKey || undefined
      });

      this.geminiFetchBtn.disabled = false;
      this.geminiFetchBtn.textContent = 'Fetch Models';

      if (result.error) { this._setStatus(`Error: ${result.error}`, 'error'); return; }

      const prev = this.geminiModelSelect.value;
      this._populateSelect(this.geminiModelSelect, result.models, prev);
      this._setStatus(`${result.models.length} model(s) found`, 'ok');
    });

    // ── Save ──
    this.saveBtn.addEventListener('click', async () => {
      const promptValue  = this.systemPromptTextarea.value.trim();
      const defaultValue = this._getBuiltinDefaultPrompt().trim();
      const systemPrompt = promptValue === defaultValue ? '' : promptValue;

      let payload;
      if (this._currentSource === 'local') {
        const url   = this.urlInput.value.trim();
        const model = this.modelSelectLocal.value;
        if (!url || !model) { this._setStatus('URL and model are required.', 'error'); return; }
        payload = { source: 'local', url, model, systemPrompt };

      } else if (this._currentSource === 'openai') {
        const model = this.openaiModelSelect.value;
        if (!model) { this._setStatus('Select a model first.', 'error'); return; }
        payload = { source: 'openai', model, systemPrompt };
      } else {
        const apiKey = this.geminiKeyInput.value.trim();
        const model = this.geminiModelSelect.value;
        if (!model) { this._setStatus('Select a Gemini model first.', 'error'); return; }
        if (!apiKey && !this._geminiHasKey) { this._setStatus('Gemini API key is required.', 'error'); return; }
        payload = { source: 'gemini', model, apiKey, systemPrompt };
      }

      this.saveBtn.disabled = true;
      const result = await ipcRenderer.invoke('llm:save-config', payload);
      this.saveBtn.disabled = false;

      if (result.error) { this._setStatus(`Save failed: ${result.error}`, 'error'); return; }
      if (payload.source === 'gemini' && payload.apiKey && payload.apiKey.trim()) {
        this._geminiHasKey = true;
      }

      this.onSaved(payload.source, payload.url || null, payload.model, {
        geminiHasKey: payload.source === 'gemini' ? (!!(payload.apiKey && payload.apiKey.trim()) || this._geminiHasKey) : this._geminiHasKey
      });
      this.close();
    });
  }

  _setStatus(msg, type) {
    this.statusEl.textContent = msg;
    this.statusEl.className = `settings-status${type ? ' ' + type : ''}`;
  }
}

module.exports = SettingsManager;
