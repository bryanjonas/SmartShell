'use strict';

const { ipcRenderer } = require('electron');

const KNOWN_SINGLE_WORD_COMMANDS = new Set([
  'cat', 'cd', 'chmod', 'chown', 'clear', 'cp', 'curl', 'date', 'df',
  'dig', 'docker', 'du', 'echo', 'env', 'exit', 'find', 'git', 'grep',
  'head', 'history', 'hostname', 'kill', 'less', 'ln', 'ls', 'make',
  'man', 'mkdir', 'mv', 'nano', 'node', 'npm', 'npx', 'ping', 'ps',
  'pwd', 'python', 'python3', 'rm', 'rmdir', 'sed', 'ssh', 'ss', 'sudo',
  'systemctl', 'tail', 'tar', 'top', 'touch', 'uname', 'vi', 'vim',
  'whoami', 'yarn'
]);

const LOW_RISK_HEADS = new Set([
  'cat', 'df', 'du', 'echo', 'env', 'find', 'git', 'grep', 'head', 'history',
  'hostname', 'less', 'ls', 'man', 'pwd', 'ss', 'tail', 'top', 'uname', 'whoami'
]);

class ChatManager {
  constructor(config = {}) {
    this.messageList   = document.getElementById('message-list');
    this.chatInput     = document.getElementById('chat-input');
    this.sendBtn       = document.getElementById('send-btn');
    this.streaming     = false;
    this.currentMessageEl = null;
    this.currentBody   = null; // The .message-body element being streamed into
    this.autoCurrentMessageEl = null;
    this.autoCurrentBody = null;
    this.commandPolicy = this._normalizeCommandPolicy(config.commandPolicy || {});

    this._bindEvents();
    this._bindIPC();
  }

  setCommandPolicy(policy) {
    this.commandPolicy = this._normalizeCommandPolicy(policy || {});
  }

  _normalizeCommandPolicy(policy) {
    const mode = String(policy.runMode || 'balanced');
    const runMode = ['strict', 'balanced', 'permissive'].includes(mode) ? mode : 'balanced';
    const toList = (value) => {
      if (!Array.isArray(value)) return [];
      return value
        .map((line) => String(line || '').trim())
        .filter(Boolean)
        .slice(0, 200);
    };
    return {
      runMode,
      allowlist: toList(policy.allowlist),
      blocklist: toList(policy.blocklist)
    };
  }

  _bindEvents() {
    this.sendBtn.addEventListener('click', () => {
      if (this.streaming) this._stopMessage();
      else this._sendMessage();
    });

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
      this._setStreamingState(false);
      if (this.currentBody) {
        this.currentBody.classList.remove('streaming-cursor');
      }
      if (this.currentMessageEl) {
        this._enhanceAssistantMessage(this.currentMessageEl);
      }
      this.currentMessageEl = null;
      this.currentBody = null;
      this.chatInput.focus();
    });

    // Error from provider
    ipcRenderer.on('chat:error', (_event, errMsg) => {
      this._setStreamingState(false);

      if (this.currentBody) {
        const msgEl = this.currentBody.closest('.message');
        if (msgEl && msgEl.textContent.trim() === 'Assistant') {
          msgEl.remove();
        } else if (this.currentBody) {
          this.currentBody.classList.remove('streaming-cursor');
        }
      }
      this.currentBody = null;
      this.currentMessageEl = null;

      this._appendMessage('error', 'Error', errMsg);
      this.chatInput.focus();
    });

    ipcRenderer.on('autochat:start', (_event, payload) => {
      if (this.autoCurrentBody) return;
      const label = payload && payload.command
        ? `Assistant (Auto · ${payload.command})`
        : 'Assistant (Auto)';
      const autoMsg = this._appendMessage('assistant', label, '');
      this.autoCurrentMessageEl = autoMsg.wrapper;
      this.autoCurrentBody = autoMsg.body;
      this.autoCurrentBody.classList.add('streaming-cursor');
    });

    ipcRenderer.on('autochat:chunk', (_event, chunk) => {
      if (!this.autoCurrentBody) return;
      this.autoCurrentBody.textContent += chunk;
      this._scrollToBottom();
    });

    ipcRenderer.on('autochat:done', () => {
      if (this.autoCurrentBody) {
        this.autoCurrentBody.classList.remove('streaming-cursor');
      }
      if (this.autoCurrentMessageEl) {
        this._enhanceAssistantMessage(this.autoCurrentMessageEl);
      }
      this.autoCurrentBody = null;
      this.autoCurrentMessageEl = null;
    });

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
      this.autoCurrentMessageEl = null;
      this._appendMessage('error', 'Auto Error', errMsg);
    });
  }

  _sendMessage() {
    const text = this.chatInput.value.trim();
    if (!text || this.streaming) return;

    this.chatInput.value = '';
    this._setStreamingState(true);

    this._appendMessage('user', 'You', text);

    const assistantMsg = this._appendMessage('assistant', 'Assistant', '');
    this.currentMessageEl = assistantMsg.wrapper;
    this.currentBody = assistantMsg.body;
    this.currentBody.classList.add('streaming-cursor');

    ipcRenderer.send('chat:send', text);
  }

  _stopMessage() {
    if (!this.streaming) return;
    ipcRenderer.send('chat:stop');
  }

  _setStreamingState(streaming) {
    this.streaming = streaming;
    this.sendBtn.disabled = false;
    this.chatInput.disabled = streaming;
    this.sendBtn.textContent = streaming ? 'Stop' : 'Send';
    this.sendBtn.classList.toggle('stop-state', streaming);
  }

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

    return { wrapper, body };
  }

  appendSystemMessage(text) {
    this._appendMessage('system', 'System', text);
  }

  _enhanceAssistantMessage(messageEl) {
    if (!messageEl || !messageEl.classList.contains('assistant')) return;
    const body = messageEl.querySelector('.message-body');
    if (!body) return;
    const raw = body.textContent || '';
    const normalizedBodyText = raw
      .replace(/```(?:bash|sh|zsh)?[ \t]*([^\n`][^\n`]*)[ \t]*```/g, '$1')
      .replace(/```(?:bash|sh|zsh)?\n([\s\S]*?)```/gi, (_, inner) => inner.trim())
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\[(?:runnable|example)\]\s*/gi, '');

    const commandCandidates = this._extractSuggestedCommands(raw)
      .map((candidate) => this._annotateCandidate(candidate));
    body.textContent = normalizedBodyText;
    if (commandCandidates.length === 0) return;

    const existing = messageEl.querySelector('.message-commands');
    if (existing) existing.remove();

    const commandsWrap = document.createElement('div');
    commandsWrap.className = 'message-commands';

    // Cards without an explicit [runnable]/[example] tag are queued for background LLM screening.
    const pendingScreen = new Map(); // cmdKey → { cardEl, actionsEl, candidate }

    for (const candidate of commandCandidates) {
      const card = document.createElement('div');
      card.className = `command-card ${candidate.status}`;

      const header = document.createElement('div');
      header.className = 'command-header';

      const codeEl = document.createElement('code');
      codeEl.className = 'command-text';
      codeEl.textContent = candidate.cmd;

      const badges = document.createElement('div');
      badges.className = 'command-badges';

      // Alert order is fixed: status alert (when needed), then safety alert.
      if (candidate.status === 'needs-edit' || candidate.status === 'example' || candidate.status === 'blocked') {
        const statusBadge = document.createElement('span');
        statusBadge.className = `command-badge status ${candidate.status}`;
        statusBadge.textContent = candidate.status === 'blocked' ? 'Blocked' : 'Needs Edit';
        statusBadge.title = `${candidate.reason} Confidence: ${Math.round(candidate.confidence * 100)}%.`;
        badges.appendChild(statusBadge);
      }

      const safetyBadge = document.createElement('span');
      safetyBadge.className = `command-badge safety ${candidate.risk}`;
      safetyBadge.textContent = `Risk: ${candidate.risk}`;
      safetyBadge.title = `Risk classification: ${candidate.risk}.`;
      badges.appendChild(safetyBadge);

      header.appendChild(codeEl);
      header.appendChild(badges);

      const actions = document.createElement('div');
      actions.className = 'command-actions';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'command-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        this._copyToClipboard(candidate.cmd, copyBtn);
      });

      actions.appendChild(copyBtn);

      if (candidate.canRun) {
        const runBtn = document.createElement('button');
        runBtn.className = 'command-btn run';
        runBtn.textContent = candidate.requireConfirm ? 'Run (Confirm)' : 'Run';
        runBtn.addEventListener('click', async () => {
          await this._attemptRunCommand(candidate, candidate.cmd, runBtn);
        });
        actions.appendChild(runBtn);
      }

      card.appendChild(header);
      card.appendChild(actions);

      commandsWrap.appendChild(card);

      if (candidate.explicitIntent === null && candidate.status !== 'blocked') {
        pendingScreen.set(candidate.cmd.toLowerCase(), { cardEl: card, actionsEl: actions, candidate });
      }
    }

    messageEl.appendChild(commandsWrap);
    this._scrollToBottom();

    if (pendingScreen.size > 0) {
      this._screenCommands(pendingScreen);
    }
  }

  async _screenCommands(pendingScreen) {
    for (const { cardEl } of pendingScreen.values()) {
      cardEl.classList.add('screening');
    }

    const promises = [...pendingScreen.values()].map(async ({ cardEl, actionsEl, candidate }) => {
      try {
        const { intent } = await ipcRenderer.invoke('command:screen', { cmd: candidate.cmd });
        cardEl.classList.remove('screening');
        if (intent === 'example') {
          this._applyExampleScreeningResult(cardEl, actionsEl);
        } else if (intent === 'runnable' && candidate.status === 'needs-edit' && !candidate.placeholder) {
          this._applyRunnableScreeningResult(cardEl, actionsEl, candidate);
        }
      } catch (_) {
        cardEl.classList.remove('screening');
      }
    });

    await Promise.allSettled(promises);
  }

  _applyExampleScreeningResult(cardEl, actionsEl) {
    cardEl.className = cardEl.className.replace(/\b(runnable|confirm)\b/g, '').trim() + ' needs-edit';

    const badges = cardEl.querySelector('.command-badges');
    if (badges) {
      let statusBadge = badges.querySelector('.command-badge.status');
      if (!statusBadge) {
        statusBadge = document.createElement('span');
        statusBadge.className = 'command-badge status needs-edit';
        badges.insertBefore(statusBadge, badges.firstChild);
      } else {
        statusBadge.className = 'command-badge status needs-edit';
      }
      statusBadge.textContent = 'Needs Edit';
      statusBadge.title = 'Screened by model: requires editing before running.';
    }

    const runBtn = actionsEl.querySelector('.command-btn.run');
    if (runBtn) runBtn.remove();
  }

  _applyRunnableScreeningResult(cardEl, actionsEl, candidate) {
    const requireConfirm = candidate.risk === 'medium';
    const newStatus = requireConfirm ? 'confirm' : 'runnable';

    cardEl.className = cardEl.className
      .replace(/\b(needs-edit|example)\b/g, '')
      .trim() + ` ${newStatus}`;

    const badges = cardEl.querySelector('.command-badges');
    if (badges) {
      const statusBadge = badges.querySelector('.command-badge.status');
      if (statusBadge) statusBadge.remove();
    }

    const upgradedCandidate = { ...candidate, requireConfirm, status: newStatus, canRun: true };
    const runBtn = document.createElement('button');
    runBtn.className = 'command-btn run';
    runBtn.textContent = requireConfirm ? 'Run (Confirm)' : 'Run';
    runBtn.addEventListener('click', async () => {
      await this._attemptRunCommand(upgradedCandidate, candidate.cmd, runBtn);
    });
    actionsEl.appendChild(runBtn);
  }

  async _attemptRunCommand(candidate, commandText, buttonEl) {
    const cmd = String(commandText || '').trim();
    if (!cmd) {
      this._appendMessage('error', 'Run Blocked', 'Command is empty.');
      return;
    }

    const original = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = 'Checking…';

    try {
      if (candidate.status === 'blocked') {
        this._appendMessage('error', 'Run Blocked', candidate.reason);
        return;
      }

      const precheck = await ipcRenderer.invoke('command:precheck', cmd);
      if (!precheck.ok) {
        this._appendMessage('error', 'Run Blocked', `Precheck failed: ${precheck.reason}`);
        return;
      }

      const needsConfirm = candidate.requireConfirm || candidate.risk === 'high';
      if (needsConfirm) {
        const confirmText = candidate.risk === 'high'
          ? `High-risk command:\n\n${cmd}\n\nContinue?`
          : `Run command?\n\n${cmd}`;
        if (!window.confirm(confirmText)) return;
      }

      ipcRenderer.send('pty:input', `${cmd}\r`);
    } catch (err) {
      this._appendMessage('error', 'Run Error', err.message || String(err));
    } finally {
      buttonEl.disabled = false;
      buttonEl.textContent = original;
    }
  }

  _extractSuggestedCommands(text) {
    const results = [];
    const seen = new Set();

    const pushCandidate = (raw, source, explicitIntent) => {
      const prefixed = this._stripIntentPrefix(raw);
      let cmd = prefixed.cmd;
      const intent = prefixed.intent || explicitIntent || null;
      if (!cmd) return;

      cmd = cmd.replace(/^\$+\s+/, '').replace(/^#+\s+/, '').trim();
      if (!this._isLikelyRunnableCommand(cmd, source)) return;

      const key = cmd.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ cmd, source, explicitIntent: intent });
    };

    // Single-line triple-backtick blocks: ```command``` or ```bash command```
    // These are common when LLMs omit newlines inside short code fences.
    const fencedSingle = /```(?:bash|sh|zsh)?[ \t]*([^\n`][^\n`]*)[ \t]*```/g;
    let match;
    while ((match = fencedSingle.exec(text)) !== null) {
      pushCandidate(match[1].trim(), 'fenced', null);
    }

    // Multi-line fenced blocks: ```\nline1\nline2\n```
    const fenced = /```(?:bash|sh|zsh)?\n([\s\S]*?)```/gi;
    while ((match = fenced.exec(text)) !== null) {
      const block = match[1] || '';
      const lines = block.split('\n');
      for (const line of lines) {
        pushCandidate(line, 'fenced', null);
      }
    }

    const inline = /`([^`\n]+)`/g;
    while ((match = inline.exec(text)) !== null) {
      const cmd = match[1] || '';
      // Skip if this backtick was already consumed by a triple-backtick match above
      if (cmd.startsWith('``') || cmd.endsWith('``')) continue;
      const contextualIntent = this._detectIntentNearIndex(text, match.index);
      pushCandidate(cmd, 'inline', contextualIntent);
    }

    return results;
  }

  _stripIntentPrefix(text) {
    let cmd = String(text || '').trim();
    let intent = null;

    const bracket = cmd.match(/^\[(runnable|example)\]\s*/i);
    if (bracket) {
      intent = bracket[1].toLowerCase();
      cmd = cmd.slice(bracket[0].length).trim();
      return { cmd, intent };
    }

    const keyword = cmd.match(/^(runnable|example|run)\s*[:\-]\s*/i);
    if (keyword) {
      const word = keyword[1].toLowerCase();
      intent = word === 'run' ? 'runnable' : word;
      cmd = cmd.slice(keyword[0].length).trim();
      return { cmd, intent };
    }

    return { cmd, intent };
  }

  _detectIntentNearIndex(text, index) {
    const start = Math.max(0, index - 48);
    const context = text.slice(start, index);
    if (/\[(example)\]\s*$/i.test(context)) return 'example';
    if (/\[(runnable)\]\s*$/i.test(context)) return 'runnable';
    if (/(example|runnable|run)\s*[:\-]\s*$/i.test(context)) {
      const m = context.match(/(example|runnable|run)\s*[:\-]\s*$/i);
      if (!m) return null;
      return m[1].toLowerCase() === 'run' ? 'runnable' : m[1].toLowerCase();
    }
    return null;
  }

  _annotateCandidate(candidate) {
    const cmd = String(candidate.cmd || '').trim();
    const allowlisted = this._matchesPatterns(this.commandPolicy.allowlist, cmd, true);
    const blocklisted = this._matchesPatterns(this.commandPolicy.blocklist, cmd, false);
    const placeholder = this._hasPlaceholderPatterns(cmd);
    const risk = this._classifyRisk(cmd);
    const confidence = this._scoreCandidate(candidate, { allowlisted, placeholder, risk });

    let status = 'runnable';
    let reason = 'Looks runnable.';
    let canRun = true;
    let requireConfirm = false;

    if (blocklisted) {
      status = 'blocked';
      reason = 'Blocked by your command blocklist policy.';
      canRun = false;
    } else if (candidate.explicitIntent === 'example') {
      status = 'example';
      reason = 'Marked by the assistant as an example command.';
      canRun = false;
    } else if (placeholder) {
      status = 'needs-edit';
      reason = 'Contains placeholder values; edit before running.';
      canRun = false;
    } else {
      const mode = this.commandPolicy.runMode;
      if (mode === 'strict') {
        if (risk === 'high') {
          status = 'blocked';
          reason = 'High-risk command blocked in strict mode.';
          canRun = false;
        } else if (confidence < 0.8) {
          status = 'needs-edit';
          reason = 'Strict mode requires higher confidence; edit command.';
          canRun = false;
        } else if (risk === 'medium') {
          status = 'confirm';
          reason = 'State-changing command requires confirmation.';
          requireConfirm = true;
        }
      } else if (mode === 'balanced') {
        if (risk === 'high') {
          status = 'blocked';
          reason = 'High-risk command blocked in balanced mode.';
          canRun = false;
        } else if (confidence < 0.45) {
          status = 'needs-edit';
          reason = 'Low confidence; edit before running.';
          canRun = false;
        } else if (risk === 'medium') {
          status = 'confirm';
          reason = 'State-changing command requires confirmation.';
          requireConfirm = true;
        }
      } else {
        if (confidence < 0.35) {
          status = 'needs-edit';
          reason = 'Very low confidence; edit before running.';
          canRun = false;
        } else if (risk === 'high') {
          status = 'confirm';
          reason = 'High-risk command requires confirmation.';
          requireConfirm = true;
        } else if (risk === 'medium') {
          status = 'confirm';
          reason = 'State-changing command requires confirmation.';
          requireConfirm = true;
        }
      }
    }

    if (allowlisted && status !== 'blocked') {
      reason = 'Matched allowlist pattern. ' + reason;
    }

    return {
      ...candidate,
      cmd,
      risk,
      confidence,
      status,
      canRun,
      requireConfirm,
      reason,
      placeholder
    };
  }

  _scoreCandidate(candidate, context) {
    const cmd = String(candidate.cmd || '').trim();
    const parts = cmd.split(/\s+/).filter(Boolean);
    const head = (parts[0] || '').toLowerCase();

    let score = candidate.source === 'fenced' ? 0.6 : 0.45;
    if (candidate.explicitIntent === 'runnable') score += 0.25;
    if (candidate.explicitIntent === 'example') score -= 0.45;
    if (context.allowlisted) score += 0.2;
    if (context.placeholder) score -= 0.55;
    if (LOW_RISK_HEADS.has(head)) score += 0.1;
    if (head === 'sudo') score -= 0.2;
    if (context.risk === 'high') score -= 0.25;

    if (score < 0) score = 0;
    if (score > 1) score = 1;
    return score;
  }

  _classifyRisk(cmd) {
    const text = String(cmd || '').trim().toLowerCase();
    const head = text.split(/\s+/)[0] || '';

    if (/\brm\s+-rf\b/.test(text)) return 'high';
    if (/\b(?:mkfs|fdisk|dd|shutdown|reboot|poweroff|halt)\b/.test(text)) return 'high';
    if (/\bchmod\s+-r\b/.test(text) || /\bchown\s+-r\b/.test(text)) return 'high';
    if (/\b:\(\)\s*\{\s*:\|:&\s*;\s*\}\s*;\s*:/.test(text)) return 'high';

    if (LOW_RISK_HEADS.has(head)) return 'low';
    if (/^git\s+(status|log|show|diff|branch)\b/.test(text)) return 'low';

    return 'medium';
  }

  _matchesPatterns(patterns, cmd, startsWithOnly) {
    const value = String(cmd || '').toLowerCase();
    for (const rawPattern of patterns || []) {
      const pattern = String(rawPattern || '').trim().toLowerCase();
      if (!pattern) continue;
      if (startsWithOnly) {
        if (value.startsWith(pattern)) return true;
      } else if (value.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  _hasPlaceholderPatterns(text) {
    const value = String(text || '').trim();
    if (/\buser@host\b/i.test(value)) return true;
    if (/<[^>\n]+>/.test(value)) return true;
    if (/\{[^}\n]+\}/.test(value)) return true;
    if (/\b(?:your[-_](?:user|username|host|hostname|path|file|dir|directory|repo|project))\b/i.test(value)) return true;
    if (/\b(?:replace[_-]?me|placeholder|example\.com)\b/i.test(value)) return true;
    if (/\b\/path\/to\//i.test(value)) return true;
    if (/\.\.\./.test(value)) return true;

    if (/^\s*ssh\s+\S+@\S+/i.test(value)) {
      const target = value.replace(/^\s*ssh\s+/i, '').split(/\s+/)[0] || '';
      if (/(?:^|@)(?:user|username|host|hostname)$/i.test(target)) return true;
    }
    return false;
  }

  _isLikelyRunnableCommand(cmd, source) {
    const normalized = (cmd || '').trim().replace(/[.,:;]+$/, '');
    if (!normalized) return false;

    if (/^\/[\w./-]+$/.test(normalized)) return false;
    if (/^~\/[\w./-]+$/.test(normalized)) return false;
    if (/^(https?:\/\/|www\.)/i.test(normalized)) return false;

    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return false;
    const head = parts[0];

    if (parts.length === 1) {
      if (!/^[a-zA-Z][\w.+-]*$/.test(head)) return false;
      if (this._looksLikeFilename(head)) return false;
      if (this._isPlaceholderToken(head)) return false;
      if (!KNOWN_SINGLE_WORD_COMMANDS.has(head.toLowerCase())) return false;
      return true;
    }

    if (!/^(?:[a-zA-Z][\w.+-]*|\.{1,2}\/[\w./-]+|\/[\w./-]+)$/.test(head)) return false;
    if (source === 'inline' && this._looksLikeFilename(head)) return false;
    // Reject title-case multi-word text: "This will...", "You need...", "Host hostname", etc.
    // Shell commands virtually never start with a capitalized prose word.
    if (/^[A-Z][a-z]/.test(head)) return false;
    // Reject lines ending with sentence punctuation — these are prose, not commands.
    if (/[.!,;]$/.test(parts[parts.length - 1])) return false;
    return true;
  }

  _looksLikeFilename(token) {
    if (!token) return false;
    if (token.startsWith('.') && token.length > 1) return true;
    if (token.includes('/')) return true;
    if (token.includes('_') && !token.includes('-')) return true;
    return false;
  }

  _isPlaceholderToken(token) {
    const v = String(token || '').trim().toLowerCase();
    return v === 'username' || v === 'hostname' || v === 'user' || v === 'host';
  }

  async _copyToClipboard(text, buttonEl) {
    const original = buttonEl.textContent;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
      }
      buttonEl.textContent = 'Copied';
    } catch (_) {
      buttonEl.textContent = 'Failed';
    } finally {
      setTimeout(() => {
        buttonEl.textContent = original;
      }, 900);
    }
  }

  _scrollToBottom() {
    this.messageList.scrollTop = this.messageList.scrollHeight;
  }
}

module.exports = ChatManager;
