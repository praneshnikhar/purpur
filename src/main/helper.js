'use strict';

const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

class HelperClient extends EventEmitter {
  constructor(appRoot, log) {
    super();
    this.log = log;
    this.proc = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.binaryPath = path.join(appRoot, 'helper', 'dist', 'Purpur Helper.app', 'Contents', 'MacOS', 'purpur-helper');
  }

  available() {
    return fs.existsSync(this.binaryPath);
  }

  start(trigger) {
    if (!this.available() || this.proc) return false;
    this.proc = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.on('data', (chunk) => this.log(`[helper] ${chunk.toString().trim()}`));
    this.proc.on('exit', (code) => {
      this.log(`helper exited (${code})`);
      const pending = [...this.pending.values()];
      this.pending.clear();
      for (const p of pending) p.reject(new Error('helper exited'));
      this.proc = null;
      this.emit('exit', code);
    });
    this.send({ cmd: 'set-trigger', trigger });
    return true;
  }

  stop() {
    if (!this.proc) return;
    try {
      this.send({ cmd: 'quit' });
    } catch {}
    setTimeout(() => {
      if (this.proc) this.proc.kill();
    }, 400);
  }

  send(obj) {
    if (!this.proc) throw new Error('helper not running');
    this.proc.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  request(cmd, params = {}, timeoutMs = 4000) {
    if (!this.proc) return Promise.reject(new Error('helper not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`helper ${cmd} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        }
      });
      this.send({ cmd, id, ...params });
    });
  }

  onData(chunk) {
    this.buffer += chunk.toString();
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        this.log(`[helper] unparsed: ${line}`);
        continue;
      }
      this.dispatch(msg);
    }
  }

  dispatch(msg) {
    if (msg.type === 'event') {
      this.emit('event', msg);
      return;
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.ok === false) p.reject(new Error(msg.error || 'helper error'));
      else p.resolve(msg);
      return;
    }
    this.emit('event', msg);
  }
}

function osascript(args) {
  return new Promise((resolve, reject) => {
    execFile('osascript', args, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function insertViaPaste(text) {
  const previous = await osascript(['-e', 'try', '-e', 'set the clipboard to (the clipboard as text)', '-e', 'on error', '-e', 'return ""', '-e', 'end try']).catch(() => '');
  await osascript(['-e', `set the clipboard to ${JSON.stringify(text)}`]);
  await osascript([
    '-e',
    'tell application "System Events" to keystroke "v" using command down'
  ]);
  if (previous) {
    setTimeout(() => {
      osascript(['-e', `set the clipboard to ${JSON.stringify(previous)}`]).catch(() => {});
    }, 400);
  }
}

async function insertText(helper, method, text, context) {
  if (method !== 'paste' && helper && helper.proc) {
    try {
      const res = await helper.request('insert', { text, context: context || null });
      return { method: res.method || 'ax', ok: true };
    } catch (err) {
      if (method === 'ax') throw err;
    }
  }
  await insertViaPaste(text);
  return { method: 'paste', ok: true };
}

module.exports = { HelperClient, insertText, insertViaPaste };
