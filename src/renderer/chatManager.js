'use strict';

const { ipcRenderer } = require('electron');

class ChatManager {
  constructor() {
    this.messageList   = document.getElementById('message-list');
    this.chatInput     = document.getElementById('chat-input');
    this.sendBtn       = document.getElementById('send-btn');
    this.streaming     = false;
    this.currentBody   = null; // The .message-body element being streamed into
    this.autoCurrentBody = null;

    this._bindEvents();
    this._bindIPC();
  }

  _bindEvents() {
    this.sendBtn.addEventListener('click', () => this._sendMessage());

    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendMessage();
      }
    });
  }

  _bindIPC() {
    // Streaming token arrives
    ipcRenderer.on('chat:chunk', (_event, chunk) => {
      if (!this.currentBody) return;
      this.currentBody.textContent += chunk;
      this._scrollToBottom();
    });

    // Stream complete
    ipcRenderer.on('chat:done', () => {
      this.streaming = false;
      this.sendBtn.disabled = false;
      this.chatInput.disabled = false;
      if (this.currentBody) {
        this.currentBody.classList.remove('streaming-cursor');
      }
      this.currentBody = null;
      this.chatInput.focus();
    });

    // Error from Ollama
    ipcRenderer.on('chat:error', (_event, errMsg) => {
      this.streaming = false;
      this.sendBtn.disabled = false;
      this.chatInput.disabled = false;

      // Remove the empty streaming placeholder if it exists
      if (this.currentBody) {
        const msgEl = this.currentBody.closest('.message');
        if (msgEl && msgEl.textContent.trim() === 'Assistant') {
          msgEl.remove();
        } else if (this.currentBody) {
          this.currentBody.classList.remove('streaming-cursor');
        }
      }
      this.currentBody = null;

      this._appendMessage('error', 'Error', errMsg);
      this.chatInput.focus();
    });

    // Auto stream start
    ipcRenderer.on('autochat:start', (_event, payload) => {
      if (this.autoCurrentBody) return;
      const label = payload && payload.command
        ? `Assistant (Auto · ${payload.command})`
        : 'Assistant (Auto)';
      this.autoCurrentBody = this._appendMessage('assistant', label, '');
      this.autoCurrentBody.classList.add('streaming-cursor');
    });

    // Auto streaming token
    ipcRenderer.on('autochat:chunk', (_event, chunk) => {
      if (!this.autoCurrentBody) return;
      this.autoCurrentBody.textContent += chunk;
      this._scrollToBottom();
    });

    // Auto stream complete
    ipcRenderer.on('autochat:done', () => {
      if (this.autoCurrentBody) {
        this.autoCurrentBody.classList.remove('streaming-cursor');
      }
      this.autoCurrentBody = null;
    });

    // Auto stream error
    ipcRenderer.on('autochat:error', (_event, errMsg) => {
      if (this.autoCurrentBody) {
        const msgEl = this.autoCurrentBody.closest('.message');
        if (msgEl && msgEl.textContent.trim().startsWith('Assistant (Auto')) {
          msgEl.remove();
        } else {
          this.autoCurrentBody.classList.remove('streaming-cursor');
        }
      }
      this.autoCurrentBody = null;
      this._appendMessage('error', 'Auto Error', errMsg);
    });
  }

  _sendMessage() {
    const text = this.chatInput.value.trim();
    if (!text || this.streaming) return;

    // Clear input
    this.chatInput.value = '';
    this.streaming = true;
    this.sendBtn.disabled = true;
    this.chatInput.disabled = true;

    // Show user message
    this._appendMessage('user', 'You', text);

    // Show empty assistant bubble with streaming cursor
    this.currentBody = this._appendMessage('assistant', 'Assistant', '');
    this.currentBody.classList.add('streaming-cursor');

    // Send to main process
    ipcRenderer.send('chat:send', text);
  }

  // Creates a message bubble and returns the .message-body element
  _appendMessage(role, roleLabel, text) {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${role}`;

    const roleEl = document.createElement('div');
    roleEl.className = 'message-role';
    roleEl.textContent = roleLabel;

    const body = document.createElement('div');
    body.className = 'message-body';
    body.textContent = text;

    wrapper.appendChild(roleEl);
    wrapper.appendChild(body);
    this.messageList.appendChild(wrapper);
    this._scrollToBottom();

    return body;
  }

  _scrollToBottom() {
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }
}

module.exports = ChatManager;
