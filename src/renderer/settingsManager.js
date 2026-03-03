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
    this.chatPane = document.getElementById('chat-pane');

    // Source tabs
    this.sourceLocalBtn  = document.getElementById('source-local-btn');
    this.sourceOpenaiBtn = document.getElementById('source-openai-btn');
    this.sourceGeminiBtn = document.getElementById('source-gemini-btn');

    // Source sections
    this.localSection  = document.getElementById('local-section');
    this.openaiSection = document.getElementById('openai-section');
    this.geminiSection = document.getElementById('gemini-section');

    // Top-level active selection
    this.activeProviderSelect = document.getElementById('settings-active-provider');
    this.activeModelSelect    = document.getElementById('settings-active-model');

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
    this.geminiClientIdInput = document.getElementById('settings-gemini-client-id');
    this.geminiConnectBtn    = document.getElementById('gemini-connect-btn');
    this.geminiDisconnectBtn = document.getElementById('gemini-disconnect-btn');
    this.geminiAuthStatus    = document.getElementById('gemini-auth-status');
    this.geminiAuthText      = document.getElementById('gemini-auth-text');
    this.geminiModelSelect  = document.getElementById('settings-model-gemini');
    this.geminiFetchBtn     = document.getElementById('settings-fetch-gemini-btn');

    // System prompt
    this.systemPromptTextarea = document.getElementById('settings-system-prompt');
    this.promptResetBtn       = document.getElementById('prompt-reset-btn');
    this.commandRunModeSelect = document.getElementById('settings-command-run-mode');
    this.commandAllowlistTextarea = document.getElementById('settings-command-allowlist');
    this.commandBlocklistTextarea = document.getElementById('settings-command-blocklist');

    // Shared actions
    this.statusEl  = document.getElementById('settings-status');
    this.cancelBtn = document.getElementById('settings-cancel-btn');
    this.saveBtn   = document.getElementById('settings-save-btn');

    // Internal state
    this._currentSource   = 'local';
    this._openaiConnected = false;
    this._geminiConnected = false;

    this._bindEvents();
  }

  isOpen() {
    return !this.panel.classList.contains('hidden');
  }

  // config = { llm: { source, url, model, openaiConnected }, systemPrompt }
  open(config) {
    this._currentSource   = config.llm.source        || 'local';
    this._openaiConnected = config.llm.openaiConnected || false;
    this._geminiConnected = config.llm.geminiConnected || false;

    // Populate local section
    this.urlInput.value = config.llm.url || '';
    this._resetSelect(this.modelSelectLocal, config.llm.source === 'local' ? config.llm.model : '');

    // Populate OpenAI Codex section
    this._updateOpenAIAuthUI(this._openaiConnected);

    // Populate Gemini section
    this.geminiClientIdInput.value = config.llm.geminiClientId || '';
    this._updateGeminiAuthUI(this._geminiConnected);
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
    const policy = config.commandPolicy || {};
    this.commandRunModeSelect.value = ['strict', 'balanced', 'permissive'].includes(policy.runMode) ? policy.runMode : 'balanced';
    this.commandAllowlistTextarea.value = (policy.allowlist || []).join('\n');
    this.commandBlocklistTextarea.value = (policy.blocklist || []).join('\n');

    // Show correct source section and initialize authoritative active selection.
    this._switchSource(this._currentSource);
    if (this.activeProviderSelect) this.activeProviderSelect.value = config.llm.source || this._currentSource;
    this._syncUnifiedFromActive(config.llm.model || '');

    this._setStatus('');
    this.panel.classList.remove('hidden');
    if (this.chatPane) this.chatPane.classList.add('settings-open');
    if (this._currentSource === 'local') {
      this.urlInput.focus();
    } else if (this._currentSource === 'gemini') {
      this.geminiClientIdInput.focus();
    }
  }

  close() {
    this.panel.classList.add('hidden');
    if (this.chatPane) this.chatPane.classList.remove('settings-open');
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

  _updateGeminiAuthUI(connected) {
    this._geminiConnected = connected;
    this.geminiAuthStatus.classList.toggle('connected', connected);
    this.geminiAuthStatus.classList.toggle('disconnected', !connected);
    this.geminiAuthText.textContent = connected ? 'Signed in' : 'Not signed in';
    this.geminiConnectBtn.classList.toggle('hidden', connected);
    this.geminiDisconnectBtn.classList.toggle('hidden', !connected);
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
    const activeSource = this.activeProviderSelect ? this.activeProviderSelect.value : this._currentSource;
    const updatedSource = this._sourceForModelSelect(selectEl);
    if (activeSource === updatedSource) {
      this._syncUnifiedFromActive(prev || selectEl.value || '');
    }
  }

  _populateActiveModelFrom(selectEl, preferredModel) {
    this.activeModelSelect.innerHTML = '';
    const options = Array.from(selectEl.querySelectorAll('option'));
    if (options.length === 0) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '— select model below —';
      this.activeModelSelect.appendChild(placeholder);
      return;
    }

    for (const opt of options) {
      const clone = document.createElement('option');
      clone.value = opt.value;
      clone.textContent = opt.textContent;
      this.activeModelSelect.appendChild(clone);
    }

    const target = preferredModel || selectEl.value || '';
    const exists = Array.from(this.activeModelSelect.options).some((o) => o.value === target);
    this.activeModelSelect.value = exists ? target : (this.activeModelSelect.options[0]?.value || '');
  }

  _sourceForModelSelect(selectEl) {
    if (selectEl === this.openaiModelSelect) return 'openai';
    if (selectEl === this.geminiModelSelect) return 'gemini';
    return 'local';
  }

  _modelSelectForSource(source) {
    if (source === 'openai') return this.openaiModelSelect;
    if (source === 'gemini') return this.geminiModelSelect;
    return this.modelSelectLocal;
  }

  _syncUnifiedFromActive(preferredModel) {
    if (!this.activeProviderSelect || !this.activeModelSelect) return;
    const source = this.activeProviderSelect.value || 'local';
    const selectEl = this._modelSelectForSource(source);
    this._populateActiveModelFrom(selectEl, preferredModel || selectEl.value);
  }

  _applyUnifiedModelToSource() {
    const selected = this.activeModelSelect.value;
    const source = this.activeProviderSelect ? this.activeProviderSelect.value : this._currentSource;
    const selectEl = this._modelSelectForSource(source);
    if (selected) selectEl.value = selected;
  }

  // Returns the built-in default system prompt (duplicated from main.js BASE_SYSTEM_PROMPT).
  _getBuiltinDefaultPrompt() {
    return [
      'You are an intelligent terminal assistant embedded in SmartShell, a split-pane terminal + AI application.',
      'You have visibility into the user\'s recent terminal session and can help them interpret command output,',
      'diagnose errors, suggest next commands, and explain what\'s happening in their shell.',
      '',
      'Guidelines:',
      '- Format shell commands in a fenced code block (```bash) or inline backtick; do not backtick filenames, paths, or output values',
      '- If the terminal output shows an error, diagnose it directly and suggest a fix',
      '- Keep responses concise — the user is in an active terminal workflow',
      '- You may reference specific lines or values from the terminal output'
    ].join('\n');
  }

  _parsePatternList(raw) {
    return String(raw || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 200);
  }

  _bindEvents() {
    // Source tabs
    this.sourceLocalBtn.addEventListener('click',  () => this._switchSource('local'));
    this.sourceOpenaiBtn.addEventListener('click', () => this._switchSource('openai'));
    this.sourceGeminiBtn.addEventListener('click', () => this._switchSource('gemini'));

    // Top-level active provider/model selectors
    this.activeProviderSelect.addEventListener('change', () => {
      this._syncUnifiedFromActive();
    });
    this.activeModelSelect.addEventListener('change', () => {
      this._applyUnifiedModelToSource();
    });

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

    // ── GEMINI: Sign in (OAuth PKCE) ──
    this.geminiConnectBtn.addEventListener('click', async () => {
      const clientId = this.geminiClientIdInput.value.trim();
      if (!clientId) { this._setStatus('Gemini OAuth Client ID is required.', 'error'); return; }

      this.geminiConnectBtn.disabled = true;
      this.geminiConnectBtn.textContent = 'Opening browser…';
      this._setStatus('Complete Gemini sign-in in the browser window that just opened.', '');

      const oauthResult = await ipcRenderer.invoke('gemini:start-oauth', { clientId });

      this.geminiConnectBtn.disabled = false;
      this.geminiConnectBtn.textContent = 'Sign in with Google';

      if (oauthResult.error) {
        this._setStatus(`Sign-in failed: ${oauthResult.error}`, 'error');
        return;
      }

      this._updateGeminiAuthUI(true);
      this._setStatus('Signed in to Gemini.', 'ok');
    });

    // ── GEMINI: Sign out ──
    this.geminiDisconnectBtn.addEventListener('click', async () => {
      this.geminiDisconnectBtn.disabled = true;
      const result = await ipcRenderer.invoke('gemini:disconnect');
      this.geminiDisconnectBtn.disabled = false;

      if (result.error) { this._setStatus(`Sign-out failed: ${result.error}`, 'error'); return; }

      this._updateGeminiAuthUI(false);
      this._setStatus('Signed out from Gemini.', 'ok');
    });

    // ── GEMINI: Fetch Models ──
    this.geminiFetchBtn.addEventListener('click', async () => {
      if (!this._geminiConnected) { this._setStatus('Sign in to Gemini first.', 'error'); return; }

      this.geminiFetchBtn.disabled = true;
      this.geminiFetchBtn.textContent = 'Fetching…';
      this._setStatus('');

      const result = await ipcRenderer.invoke('llm:fetch-models', {
        source: 'gemini'
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
      const systemPrompt = this.systemPromptTextarea.value.trim();
      const authoritativeSource = this.activeProviderSelect.value || this._currentSource;
      this._switchSource(authoritativeSource);
      this._applyUnifiedModelToSource();

      let payload;
      const commandPolicy = {
        runMode: this.commandRunModeSelect.value,
        allowlist: this._parsePatternList(this.commandAllowlistTextarea.value),
        blocklist: this._parsePatternList(this.commandBlocklistTextarea.value)
      };
      if (authoritativeSource === 'local') {
        const url   = this.urlInput.value.trim();
        const model = this.activeModelSelect.value || this.modelSelectLocal.value;
        if (!url || !model) { this._setStatus('URL and model are required.', 'error'); return; }
        payload = { source: 'local', url, model, systemPrompt, commandPolicy };

      } else if (authoritativeSource === 'openai') {
        const model = this.activeModelSelect.value || this.openaiModelSelect.value;
        if (!model) { this._setStatus('Select a model first.', 'error'); return; }
        payload = { source: 'openai', model, systemPrompt, commandPolicy };
      } else {
        const clientId = this.geminiClientIdInput.value.trim();
        const model = this.activeModelSelect.value || this.geminiModelSelect.value;
        if (!model) { this._setStatus('Select a Gemini model first.', 'error'); return; }
        if (!clientId) { this._setStatus('Gemini OAuth Client ID is required.', 'error'); return; }
        if (!this._geminiConnected) { this._setStatus('Sign in to Gemini first.', 'error'); return; }
        payload = { source: 'gemini', model, clientId, systemPrompt, commandPolicy };
      }

      this.saveBtn.disabled = true;
      const result = await ipcRenderer.invoke('llm:save-config', payload);
      this.saveBtn.disabled = false;

      if (result.error) { this._setStatus(`Save failed: ${result.error}`, 'error'); return; }

      this.onSaved(payload.source, payload.url || null, payload.model, {
        geminiConnected: this._geminiConnected,
        geminiClientId: payload.source === 'gemini' ? (payload.clientId || this.geminiClientIdInput.value.trim()) : this.geminiClientIdInput.value.trim(),
        commandPolicy: payload.commandPolicy
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
