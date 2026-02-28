'use strict';

// Strips ANSI escape codes from a string
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

// Matches common shell prompts at end of a line: "$ ", "# ", "% ", "> "
// Handles prompts like: "user@host:~/path$ ", "root# ", "[user@host ~]$ ", "% "
const PROMPT_PATTERN = /(?:\$|#|%|>)\s*$/;

class ContextBuffer {
  constructor(maxEntries = 10, maxOutputChars = 2000) {
    this.maxEntries = maxEntries;
    this.maxOutputChars = maxOutputChars;

    // Ring buffer of { command, output } entries
    this.entries = [];

    // State machine: 'IDLE' | 'COLLECTING_OUTPUT'
    this.state = 'IDLE';

    // Accumulated user input characters (tracked from pty:input)
    this.inputAccumulator = '';

    // The command we're currently collecting output for
    this.pendingCommand = '';

    // Accumulated PTY output since last Enter
    this.outputAccumulator = '';
  }

  // Called from pty:input handler when user presses Enter
  notifyEnter() {
    if (this.state === 'IDLE') {
      this.pendingCommand = this.inputAccumulator.trim();
      this.outputAccumulator = '';
      this.state = 'COLLECTING_OUTPUT';
    }
    this.inputAccumulator = '';
  }

  // Called for every byte of PTY output (from ptyManager 'output' event)
  appendOutput(rawData) {
    if (this.state !== 'COLLECTING_OUTPUT') return;

    // Strip ANSI codes for clean context
    const clean = rawData.replace(ANSI_REGEX, '');

    // Truncate to maxOutputChars
    if (this.outputAccumulator.length < this.maxOutputChars) {
      const remaining = this.maxOutputChars - this.outputAccumulator.length;
      if (clean.length > remaining) {
        this.outputAccumulator += clean.slice(0, remaining) + '\n[... output truncated ...]';
      } else {
        this.outputAccumulator += clean;
      }
    }

    // Check if a shell prompt has appeared (command finished)
    const lines = this.outputAccumulator.split('\n');
    const lastLine = lines[lines.length - 1];
    if (PROMPT_PATTERN.test(lastLine)) {
      this._finalizeEntry();
    }
  }

  _finalizeEntry() {
    if (this.pendingCommand) {
      this.entries.push({
        command: this.pendingCommand,
        output: this.outputAccumulator.trim()
      });

      // Maintain rolling window
      if (this.entries.length > this.maxEntries) {
        this.entries.shift();
      }
    }

    this.pendingCommand = '';
    this.outputAccumulator = '';
    this.state = 'IDLE';
  }

  // Format entries for inclusion in the LLM system prompt
  serialize() {
    if (this.entries.length === 0) {
      return 'No commands have been run yet in this session.';
    }

    return this.entries.map((e, i) =>
      `[${i + 1}] $ ${e.command}\n${e.output || '(no output)'}`
    ).join('\n\n---\n\n');
  }

  getEntries() {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
    this.state = 'IDLE';
    this.inputAccumulator = '';
    this.pendingCommand = '';
    this.outputAccumulator = '';
  }
}

module.exports = new ContextBuffer();
