'use strict';

const pty = require('node-pty');
const EventEmitter = require('events');

class PtyManager extends EventEmitter {
  constructor() {
    super();
    this.ptyProcess = null;
  }

  spawn(shell, env, cols, rows) {
    if (this.ptyProcess) {
      this.destroy();
    }

    this.ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: process.env.HOME || process.cwd(),
      env: {
        ...env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      }
    });

    this.ptyProcess.onData(data => {
      this.emit('output', data);
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.emit('exit', exitCode, signal);
    });
  }

  write(data) {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    }
  }

  resize(cols, rows) {
    if (this.ptyProcess && cols > 0 && rows > 0) {
      try {
        this.ptyProcess.resize(cols, rows);
      } catch (err) {
        // Resize can fail if the process is in the middle of exiting
        console.warn('[ptyManager] resize failed:', err.message);
      }
    }
  }

  destroy() {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.destroy();
      } catch (err) {
        // Ignore errors on destroy
      }
      this.ptyProcess = null;
    }
  }
}

module.exports = new PtyManager();
