'use strict';

const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { ipcRenderer } = require('electron');

class TerminalManager {
  constructor(config) {
    this.config = config;
    this.terminal = null;
    this.fitAddon = null;
    this._resizeTimer = null;
  }

  init(containerEl) {
    this.terminal = new Terminal({
      fontFamily: this.config.terminal.fontFamily,
      fontSize: this.config.terminal.fontSize,
      theme: {
        background:          '#0d0d0d',
        foreground:          '#d4d4d4',
        cursor:              '#5a8dee',
        cursorAccent:        '#0d0d0d',
        selectionBackground: '#264f7844',
        black:   '#1e1e1e', brightBlack:   '#555555',
        red:     '#f44747', brightRed:     '#f44747',
        green:   '#6a9955', brightGreen:   '#6a9955',
        yellow:  '#d7ba7d', brightYellow:  '#d7ba7d',
        blue:    '#569cd6', brightBlue:    '#9cdcfe',
        magenta: '#c586c0', brightMagenta: '#c586c0',
        cyan:    '#4ec9b0', brightCyan:    '#4ec9b0',
        white:   '#d4d4d4', brightWhite:   '#ffffff',
      },
      cursorBlink: true,
      scrollback: 10000,
      allowTransparency: false,
      convertEol: false,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    this.terminal.open(containerEl);

    // Forward PTY output to xterm display
    ipcRenderer.on('pty:output', (_event, data) => {
      this.terminal.write(data);
    });

    // Forward xterm keystrokes to PTY
    this.terminal.onData((data) => {
      ipcRenderer.send('pty:input', data);
    });

    // Initial fit after a short delay to let the DOM settle
    setTimeout(() => this.fitToContainer(), 50);

    // Watch for container size changes (window resize or drag-handle)
    const observer = new ResizeObserver(() => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this.fitToContainer(), 50);
    });
    observer.observe(containerEl);

    // Focus the terminal so it captures keyboard input immediately
    this.terminal.focus();
  }

  fitToContainer() {
    try {
      this.fitAddon.fit();
      const { cols, rows } = this.terminal;
      ipcRenderer.send('pty:resize', cols, rows);
    } catch (err) {
      // FitAddon can throw before the terminal is fully attached
    }
  }

  focus() {
    if (this.terminal) this.terminal.focus();
  }
}

module.exports = TerminalManager;
