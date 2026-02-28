'use strict';

const { ipcRenderer } = require('electron');

class SettingsManager {
  constructor(onSaved) {
    this.onSaved   = onSaved; // callback(url, model) after a successful save

    this.panel     = document.getElementById('settings-panel');
    this.urlInput  = document.getElementById('settings-url');
    this.fetchBtn  = document.getElementById('settings-fetch-btn');
    this.modelSelect = document.getElementById('settings-model');
    this.statusEl  = document.getElementById('settings-status');
    this.cancelBtn = document.getElementById('settings-cancel-btn');
    this.saveBtn   = document.getElementById('settings-save-btn');

    this._bindEvents();
  }

  isOpen() {
    return !this.panel.classList.contains('hidden');
  }

  open(currentUrl, currentModel) {
    this.urlInput.value = currentUrl || '';
    this._resetSelect(currentModel);
    this._setStatus('');
    this.panel.classList.remove('hidden');
    this.urlInput.focus();
  }

  close() {
    this.panel.classList.add('hidden');
  }

  _resetSelect(currentModel) {
    this.modelSelect.innerHTML = '';
    if (currentModel) {
      const opt = document.createElement('option');
      opt.value = currentModel;
      opt.textContent = currentModel;
      this.modelSelect.appendChild(opt);
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— fetch models first —';
      this.modelSelect.appendChild(opt);
    }
  }

  _bindEvents() {
    this.cancelBtn.addEventListener('click', () => this.close());

    this.fetchBtn.addEventListener('click', async () => {
      const url = this.urlInput.value.trim();
      if (!url) { this._setStatus('Enter a server URL first.', 'error'); return; }

      this.fetchBtn.disabled = true;
      this.fetchBtn.textContent = 'Fetching…';
      this._setStatus('');

      const result = await ipcRenderer.invoke('llm:fetch-models', { url });

      this.fetchBtn.disabled = false;
      this.fetchBtn.textContent = 'Fetch Models';

      if (result.error) {
        this._setStatus(`Error: ${result.error}`, 'error');
        return;
      }

      // Remember currently selected model so we can reselect it
      const prev = this.modelSelect.value;

      this.modelSelect.innerHTML = '';
      for (const m of result.models) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        this.modelSelect.appendChild(opt);
      }

      // Reselect previous model if it's in the new list, otherwise take the first
      if (prev && result.models.includes(prev)) {
        this.modelSelect.value = prev;
      }

      this._setStatus(`${result.models.length} model(s) found`, 'ok');
    });

    this.saveBtn.addEventListener('click', async () => {
      const url   = this.urlInput.value.trim();
      const model = this.modelSelect.value;
      if (!url || !model) {
        this._setStatus('URL and model are required.', 'error');
        return;
      }

      this.saveBtn.disabled = true;
      const result = await ipcRenderer.invoke('llm:save-config', { url, model });
      this.saveBtn.disabled = false;

      if (result.error) {
        this._setStatus(`Save failed: ${result.error}`, 'error');
        return;
      }

      this.onSaved(url, model);
      this.close();
    });
  }

  _setStatus(msg, type) {
    this.statusEl.textContent = msg;
    this.statusEl.className = `settings-status${type ? ' ' + type : ''}`;
  }
}

module.exports = SettingsManager;
