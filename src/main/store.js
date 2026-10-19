'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULTS = {
  trigger: 'option-hold',
  fallbackShortcut: 'CommandOrControl+Shift+Space',
  provider: 'mock',
  sttBaseUrl: 'https://api.openai.com/v1',
  sttApiKey: '',
  sttModel: 'gpt-4o-transcribe',
  sttLanguage: '',
  whisperBinary: '',
  whisperArgs: '-m {model} -f {wav} -nt',
  whisperModel: '',
  livePartials: true,
  cleanupEnabled: false,
  cleanupBaseUrl: 'https://api.openai.com/v1',
  cleanupApiKey: '',
  cleanupModel: 'gpt-4o-mini',
  cleanupStyle: 'clean',
  dictionary: [],
  sounds: true,
  soundVolume: 0.5,
  insertMethod: 'auto',
  historyLimit: 500
};

function loadJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function atomicWrite(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.settingsFile = path.join(dir, 'settings.json');
    this.historyFile = path.join(dir, 'history.json');
    fs.mkdirSync(dir, { recursive: true });
    this.settings = { ...DEFAULTS, ...loadJson(this.settingsFile, {}) };
    this.history = loadJson(this.historyFile, []);
  }

  getSettings() {
    return { ...this.settings };
  }

  saveSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    atomicWrite(this.settingsFile, this.settings);
    return this.getSettings();
  }

  listHistory(query) {
    const items = query
      ? this.history.filter((h) => (h.text || '').toLowerCase().includes(String(query).toLowerCase()))
      : this.history;
    return items.slice(0, this.settings.historyLimit);
  }

  addHistory(entry) {
    const record = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      ...entry
    };
    this.history.unshift(record);
    if (this.history.length > this.settings.historyLimit) {
      this.history.length = this.settings.historyLimit;
    }
    atomicWrite(this.historyFile, this.history);
    return record;
  }

  deleteHistory(id) {
    this.history = this.history.filter((h) => h.id !== id);
    atomicWrite(this.historyFile, this.history);
    return this.listHistory();
  }

  clearHistory() {
    this.history = [];
    atomicWrite(this.historyFile, this.history);
    return [];
  }
}

module.exports = { Store, DEFAULTS };
