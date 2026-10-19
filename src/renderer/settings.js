'use strict';

const $ = (id) => document.getElementById(id);
let settings = {};
let saveTimer = null;

const FIELDS = [
  'trigger', 'fallbackShortcut', 'insertMethod', 'sounds', 'soundVolume',
  'provider', 'sttBaseUrl', 'sttApiKey', 'sttModel', 'sttLanguage', 'livePartials',
  'whisperBinary', 'whisperModel', 'whisperArgs',
  'cleanupEnabled', 'cleanupBaseUrl', 'cleanupApiKey', 'cleanupModel', 'cleanupStyle'
];

function flashSaved(text = 'Saved') {
  const el = $('save-state');
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.textContent = ''), 1400);
}

function readForm() {
  const patch = {};
  for (const key of FIELDS) {
    const el = $(key);
    if (!el) continue;
    if (el.type === 'checkbox') patch[key] = el.checked;
    else if (el.type === 'range') patch[key] = Number(el.value);
    else patch[key] = el.value;
  }
  return patch;
}

function applyForm(s) {
  for (const key of FIELDS) {
    const el = $(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(s[key]);
    else el.value = s[key] ?? '';
  }
  updateProviderVisibility();
}

function updateProviderVisibility() {
  const provider = $('provider').value;
  $('openai-fields').classList.toggle('hidden', provider !== 'openai');
  $('whisper-fields').classList.toggle('hidden', provider !== 'whisper');
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    settings = await window.purpur.saveSettings(readForm());
    flashSaved();
  }, 350);
}

async function renderDictionary() {
  const list = $('dict-list');
  const entries = settings.dictionary || [];
  list.innerHTML = entries.length
    ? ''
    : '<li><span class="grow">No entries yet.</span></li>';
  entries.forEach((entry, index) => {
    const li = document.createElement('li');
    const grow = document.createElement('span');
    grow.className = 'grow';
    grow.textContent = `${entry.from} → ${entry.to}`;
    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = 'Remove';
    del.onclick = async () => {
      const next = entries.filter((_, i) => i !== index);
      settings = await window.purpur.saveSettings({ dictionary: next });
      renderDictionary();
      flashSaved();
    };
    li.append(grow, del);
    list.append(li);
  });
}

async function renderHistory(query = '') {
  const list = $('history-list');
  const items = await window.purpur.listHistory(query);
  list.innerHTML = items.length ? '' : '<li><span class="grow">No dictations yet.</span></li>';
  for (const item of items) {
    const li = document.createElement('li');
    const grow = document.createElement('span');
    grow.className = 'grow';
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = item.text;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const when = new Date(item.ts).toLocaleString();
    const secs = item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}s` : '—';
    meta.textContent = `${when} · ${item.app || 'unknown app'} · ${secs} · ${item.provider} · ${item.insertMethod} · ${item.latencyMs ?? '—'}ms`;
    grow.append(text, meta);
    const copy = document.createElement('button');
    copy.className = 'btn';
    copy.textContent = 'Copy';
    copy.onclick = () => {
      navigator.clipboard.writeText(item.text);
      flashSaved('Copied');
    };
    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = 'Delete';
    del.onclick = async () => {
      await window.purpur.deleteHistory(item.id);
      renderHistory($('history-search').value);
    };
    li.append(grow, copy, del);
    list.append(li);
  }
}

function renderPermissions(perms) {
  const mic = $('perm-mic');
  mic.textContent = perms.microphone || 'unknown';
  mic.className = perms.microphone === 'granted' ? 'ok' : 'bad';
  const ax = $('perm-ax');
  if (perms.accessibility == null) {
    ax.textContent = 'helper not running';
    ax.className = 'bad';
  } else {
    ax.textContent = perms.accessibility ? 'granted' : 'not granted';
    ax.className = perms.accessibility ? 'ok' : 'bad';
  }
  const input = $('perm-input');
  if (perms.inputMonitoring == null) {
    input.textContent = 'helper not running';
    input.className = 'bad';
  } else {
    input.textContent = perms.inputMonitoring ? 'granted' : 'not granted';
    input.className = perms.inputMonitoring ? 'ok' : 'bad';
  }
}

async function refreshPermissions() {
  renderPermissions(await window.purpur.getPermissions());
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.panel').forEach((p) =>
      p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`)
    );
    if (tab.dataset.tab === 'history') renderHistory($('history-search').value);
    if (tab.dataset.tab === 'permissions') refreshPermissions();
  };
});

FIELDS.forEach((key) => {
  const el = $(key);
  if (!el) return;
  el.addEventListener('change', () => {
    if (key === 'provider') updateProviderVisibility();
    scheduleSave();
  });
  if (el.type === 'text' || el.type === 'password') el.addEventListener('input', scheduleSave);
  if (el.type === 'range') el.addEventListener('input', scheduleSave);
});

$('btn-start').onclick = () => window.purpur.startDictation();
$('btn-stop').onclick = () => window.purpur.stopDictation();

$('btn-test-stt').onclick = async () => {
  $('stt-result').textContent = 'testing…';
  try {
    const result = await window.purpur.testStt();
    $('stt-result').textContent = result ? `echo: ${result.slice(0, 120)}` : 'no text returned';
  } catch (err) {
    $('stt-result').textContent = `failed: ${err.message}`;
  }
};

$('btn-test-cleanup').onclick = async () => {
  $('cleanup-result').textContent = 'testing…';
  try {
    const result = await window.purpur.testCleanup();
    $('cleanup-result').textContent = result.slice(0, 160);
  } catch (err) {
    $('cleanup-result').textContent = `failed: ${err.message}`;
  }
};

$('dict-add').onclick = async () => {
  const from = $('dict-from').value.trim();
  const to = $('dict-to').value.trim();
  if (!from || !to) return;
  settings = await window.purpur.saveSettings({
    dictionary: [...(settings.dictionary || []), { from, to }]
  });
  $('dict-from').value = '';
  $('dict-to').value = '';
  renderDictionary();
  flashSaved();
};

$('history-search').addEventListener('input', (e) => renderHistory(e.target.value));
$('btn-clear-history').onclick = async () => {
  await window.purpur.clearHistory();
  renderHistory();
};

document.querySelectorAll('[data-perm]').forEach((btn) => {
  btn.onclick = () => window.purpur.openPermissionPane(btn.dataset.perm);
});
$('btn-refresh-perms').onclick = refreshPermissions;
$('btn-request-mic').onclick = async () => {
  await window.purpur.requestMic();
  refreshPermissions();
};

(async function init() {
  settings = await window.purpur.getSettings();
  applyForm(settings);
  renderDictionary();
  renderHistory();
  refreshPermissions();
})();
