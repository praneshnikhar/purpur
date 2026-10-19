'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen, shell, systemPreferences, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { Store } = require('./store');
const { HelperClient, insertText } = require('./helper');
const { transcribe, pcmToWav, applyDictionary } = require('./stt');
const { cleanup } = require('./cleanup');

const APP_ROOT = path.join(__dirname, '..', '..');
const SMOKE = process.argv.includes('--smoke');

app.setName('purpur');

let store;
let helper;
let tray;
let pillWin;
let settingsWin;
let state = 'idle';
let session = null;
let partialTimer = null;

function log(msg) {
  console.log(`[purpur] ${msg}`);
}

function send(channel) {
  if (!pillWin || pillWin.isDestroyed()) return;
  pillWin.webContents.send(channel, ...Array.from(arguments).slice(1));
}

function setState(phase, payload = {}) {
  state = phase;
  send('state', { phase, ...payload });
}

function assetFile(name) {
  return path.join(APP_ROOT, 'assets', name);
}

function ensureOnboardingFiles() {
  const dir = app.getPath('userData');
  const marker = path.join(dir, 'onboarded');
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, new Date().toISOString());
}

function createPill() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 340;
  const height = 76;
  pillWin = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height - height - 28),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  pillWin.setAlwaysOnTop(true, 'screen-saver');
  pillWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pillWin.loadFile(path.join(__dirname, '..', 'renderer', 'pill.html'));
  pillWin.on('closed', () => {
    pillWin = null;
  });
}

function showPill() {
  if (pillWin && !pillWin.isDestroyed()) {
    pillWin.setAlwaysOnTop(true, 'screen-saver');
    pillWin.showInactive();
  }
}

function hidePillSoon(ms = 1500) {
  setTimeout(() => {
    if (pillWin && !pillWin.isDestroyed()) pillWin.hide();
  }, ms);
}

function createSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 780,
    height: 620,
    title: 'purpur',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

function createTray() {
  const iconPath = assetFile('trayTemplate.png');
  const image = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('purpur — push to talk');
  refreshTrayMenu();
  tray.on('click', () => createSettings());
}

function refreshTrayMenu() {
  if (!tray) return;
  const helperStatus = !helper ? 'not started' : helper.available() ? (helper.proc ? 'running' : 'installed') : 'not built';
  const menu = Menu.buildFromTemplate([
    {
      label: state === 'idle' ? 'Start dictation' : 'Stop dictation',
      click: () => (state === 'idle' ? beginSession('manual') : endSession('manual'))
    },
    { type: 'separator' },
    { label: 'Settings…', click: () => createSettings() },
    { type: 'separator' },
    { label: `Helper: ${helperStatus}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit purpur', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

function registerFallbackShortcut() {
  globalShortcut.unregisterAll();
  const accel = store.getSettings().fallbackShortcut;
  if (!accel) return;
  try {
    const ok = globalShortcut.register(accel, () => {
      if (state === 'idle') beginSession('shortcut');
      else if (state === 'listening') endSession('shortcut');
    });
    if (!ok) log(`fallback shortcut ${accel} could not be registered`);
  } catch (err) {
    log(`fallback shortcut error: ${err.message}`);
  }
}

async function fetchContext() {
  if (helper && helper.proc) {
    try {
      const res = await helper.request('context', {}, 2000);
      return res.context || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function beginSession(source) {
  if (state !== 'idle') return;
  session = {
    source,
    startedAt: Date.now(),
    chunks: [],
    context: null,
    partialText: ''
  };
  showPill();
  setState('listening', { sfx: 'start' });
  refreshTrayMenu();
  send('capture', 'start');
  fetchContext().then((ctx) => {
    if (session) session.context = ctx;
  });
  if (store.getSettings().livePartials && store.getSettings().provider === 'openai') {
    let busy = false;
    partialTimer = setInterval(async () => {
      if (!session || busy) return;
      busy = true;
      try {
        const pcm = Buffer.concat(session.chunks);
        if (pcm.length > 16000) {
          const settings = store.getSettings();
          const text = await transcribe(settings, pcm, log);
          if (session && text) {
            session.partialText = text;
            send('partial', text);
          }
        }
      } catch (err) {
        log(`partial failed: ${err.message}`);
      } finally {
        busy = false;
      }
    }, 2400);
  }
}

async function endSession(source) {
  if (state !== 'listening' || !session) return;
  clearInterval(partialTimer);
  partialTimer = null;
  const current = session;
  session = null;
  setState('processing', { sfx: 'stop' });
  refreshTrayMenu();

  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('audio-ended', done);
      resolve();
    };
    ipcMain.on('audio-ended', done);
    setTimeout(done, 2500);
    send('capture', 'stop');
  });

  const pcm = Buffer.concat(current.chunks);
  const settings = store.getSettings();
  const started = Date.now();
  try {
    let text = await transcribe(settings, pcm, log);
    text = applyDictionary(text, settings.dictionary);
    setState('cleanup', { text });
    text = await cleanup(settings, text, current.context, log);
    text = applyDictionary(text, settings.dictionary);
    if (!text.trim()) throw new Error('no speech detected');
    setState('inserting', { text });
    const result = await insertText(helper, settings.insertMethod, text, current.context);
    const latency = Date.now() - started;
    store.addHistory({
      text,
      rawText: current.partialText || '',
      app: current.context?.app || null,
      durationMs: current.startedAt ? Date.now() - current.startedAt : null,
      provider: settings.provider,
      insertMethod: result.method,
      latencyMs: latency
    });
    setState('inserted', { text, sfx: 'done' });
    refreshTrayMenu();
    hidePillSoon(1800);
  } catch (err) {
    log(`session failed: ${err.stack || err.message}`);
    setState('error', { message: err.message, sfx: 'error' });
    hidePillSoon(3200);
  } finally {
    state = state === 'inserted' || state === 'error' ? 'idle' : 'idle';
    refreshTrayMenu();
  }
}

function startHelper() {
  if (!helper) return;
  if (!helper.available()) {
    log('helper not built — run: npm run build:helper (fallback shortcut still works)');
    return;
  }
  if (SMOKE) {
    log('smoke mode: helper spawn skipped (avoids TCC prompt)');
    return;
  }
  helper.start(store.getSettings().trigger);
}

function wireHelper() {
  helper = new HelperClient(APP_ROOT, log);
  helper.on('event', (msg) => {
    if (msg.event === 'hotkey') {
      if (msg.phase === 'start') beginSession(msg.source || 'helper');
      else if (msg.phase === 'stop') endSession(msg.source || 'helper');
    } else if (msg.event === 'tap-failed') {
      log('helper event tap failed — grant Accessibility + Input Monitoring to Purpur Helper');
    } else if (msg.event === 'ready') {
      log(`helper ready (trigger ${msg.trigger})`);
    }
  });
  helper.on('exit', () => refreshTrayMenu());
}

function registerIpc() {
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:save', (e, patch) => {
    const before = store.getSettings();
    const after = store.saveSettings(patch);
    if (before.trigger !== after.trigger || before.fallbackShortcut !== after.fallbackShortcut) {
      if (helper && helper.proc) helper.send({ cmd: 'set-trigger', trigger: after.trigger });
      registerFallbackShortcut();
    }
    return after;
  });
  ipcMain.handle('history:list', (e, query) => store.listHistory(query));
  ipcMain.handle('history:delete', (e, id) => store.deleteHistory(id));
  ipcMain.handle('history:clear', () => store.clearHistory());
  ipcMain.handle('dictation:start', () => beginSession('ui'));
  ipcMain.handle('dictation:stop', () => endSession('ui'));
  ipcMain.handle('permissions:get', async () => {
    const mic = systemPreferences.getMediaAccessStatus('microphone');
    let helperPerms = null;
    if (helper && helper.proc) {
      try {
        helperPerms = (await helper.request('permissions', {}, 2000)).permissions || null;
      } catch {}
    }
    return { microphone: mic, ...(helperPerms || {}) };
  });
  ipcMain.handle('permissions:request-mic', async () => systemPreferences.askForMediaAccess('microphone'));
  ipcMain.handle('permissions:open', (e, kind) => {
    const panes = {
      microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      input: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'
    };
    shell.openExternal(panes[kind] || panes.accessibility);
  });
  ipcMain.handle('engine:test-stt', async () => {
    const settings = store.getSettings();
    const sample = pcmToWav(Buffer.alloc(16000));
    const res = await transcribe(
      { ...settings, provider: settings.provider === 'mock' ? 'mock' : settings.provider },
      sample.subarray(44),
      log
    );
    return res;
  });
  ipcMain.handle('engine:test-cleanup', async () => {
    const settings = store.getSettings();
    const text = await cleanup(
      { ...settings, cleanupEnabled: true },
      'um so like i think we should uh ship this on friday right',
      { app: 'purpur' },
      log
    );
    return text;
  });
  ipcMain.handle('app:asset-path', (e, name) => assetFile(name));
  ipcMain.handle('app:open-settings', () => createSettings());
  ipcMain.on('audio-chunk', (e, arrayBuffer) => {
    if (session) session.chunks.push(Buffer.from(arrayBuffer));
  });
  ipcMain.on('audio-level', (e, level) => {
    send('level', level);
  });
  ipcMain.on('audio-ended', () => {});
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => createSettings());
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  ensureOnboardingFiles();
  registerIpc();
  wireHelper();
  createPill();
  createTray();
  startHelper();
  registerFallbackShortcut();
  if (SMOKE) {
    setTimeout(() => {
      console.log('SMOKE OK');
      app.quit();
    }, 5000);
  }
});

app.on('window-all-closed', (e) => {});
app.on('before-quit', () => {
  clearInterval(partialTimer);
  if (helper) helper.stop();
});
