'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('purpur', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  listHistory: (query) => ipcRenderer.invoke('history:list', query),
  deleteHistory: (id) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  startDictation: () => ipcRenderer.invoke('dictation:start'),
  stopDictation: () => ipcRenderer.invoke('dictation:stop'),
  getPermissions: () => ipcRenderer.invoke('permissions:get'),
  requestMic: () => ipcRenderer.invoke('permissions:request-mic'),
  openPermissionPane: (kind) => ipcRenderer.invoke('permissions:open', kind),
  testStt: () => ipcRenderer.invoke('engine:test-stt'),
  testCleanup: () => ipcRenderer.invoke('engine:test-cleanup'),
  assetPath: (name) => ipcRenderer.invoke('app:asset-path', name),
  onState: (cb) => ipcRenderer.on('state', (e, payload) => cb(payload)),
  onPartial: (cb) => ipcRenderer.on('partial', (e, text) => cb(text)),
  onLevel: (cb) => ipcRenderer.on('level', (e, level) => cb(level)),
  onCaptureCommand: (cb) => ipcRenderer.on('capture', (e, action) => cb(action)),
  sendAudioChunk: (arrayBuffer) => ipcRenderer.send('audio-chunk', arrayBuffer),
  sendAudioLevel: (level) => ipcRenderer.send('audio-level', level),
  sendAudioEnded: () => ipcRenderer.send('audio-ended')
});
