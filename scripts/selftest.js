'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
let failures = 0;

function check(name, fn) {
  try {
    const detail = fn();
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name} — ${err.message}`);
  }
}

async function asyncCheck(name, fn) {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name} — ${err.message}`);
  }
}

(async function run() {
  check('store round-trip (settings + history)', () => {
    const { Store } = require(path.join(root, 'src/main/store.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purpur-selftest-'));
    const store = new Store(dir);
    const saved = store.saveSettings({ provider: 'mock', sounds: false });
    if (saved.provider !== 'mock' || saved.sounds !== false) throw new Error('settings not persisted');
    const entry = store.addHistory({ text: 'hello purpur', provider: 'mock', insertMethod: 'ax' });
    const listed = store.listHistory('hello');
    if (listed.length !== 1 || listed[0].id !== entry.id) throw new Error('history lookup failed');
    store.deleteHistory(entry.id);
    if (store.listHistory().length !== 0) throw new Error('history delete failed');
    fs.rmSync(dir, { recursive: true, force: true });
    return 'ok';
  });

  check('WAV encoding', () => {
    const { pcmToWav } = require(path.join(root, 'src/main/stt.js'));
    const pcm = Buffer.alloc(32000);
    const wav = pcmToWav(pcm);
    if (wav.subarray(0, 4).toString() !== 'RIFF') throw new Error('missing RIFF');
    if (wav.subarray(8, 12).toString() !== 'WAVE') throw new Error('missing WAVE');
    if (wav.readUInt32LE(24) !== 16000) throw new Error('bad sample rate');
    if (wav.length !== pcm.length + 44) throw new Error('bad length');
    return `${wav.length} bytes, 16 kHz mono`;
  });

  check('dictionary substitution', () => {
    const { applyDictionary } = require(path.join(root, 'src/main/stt.js'));
    const out = applyDictionary('we use whisper flow daily', [{ from: 'whisper flow', to: 'Wispr Flow' }]);
    if (out !== 'we use Wispr Flow daily') throw new Error(`unexpected: ${out}`);
    return 'ok';
  });

  check('cleanup prompt builder', () => {
    const { buildPrompt } = require(path.join(root, 'src/main/cleanup.js'));
    const prompt = buildPrompt(
      { cleanupStyle: 'email', dictionary: [{ from: 'gee pee tee', to: 'GPT' }] },
      { app: 'Mail' }
    );
    if (!prompt.includes('Mail') || !prompt.includes('GPT')) throw new Error('prompt missing context or dictionary');
    return 'ok';
  });

  await asyncCheck('mock transcription (demo provider)', async () => {
    const { transcribe } = require(path.join(root, 'src/main/stt.js'));
    const text = await transcribe({ provider: 'mock' }, Buffer.alloc(32000), () => {});
    if (!text.includes('mock provider')) throw new Error('unexpected output');
    return 'ok';
  });

  check('generated assets present', () => {
    const required = ['icon.png', 'trayTemplate.png', 'start.wav', 'stop.wav', 'done.wav', 'error.wav'];
    const missing = required.filter((f) => !fs.existsSync(path.join(root, 'assets', f)));
    if (missing.length) throw new Error(`missing: ${missing.join(', ')} — run npm run gen:assets`);
    return required.length + ' files';
  });

  check('helper binary present and signed', () => {
    const bin = path.join(root, 'helper/dist/Purpur Helper.app/Contents/MacOS/purpur-helper');
    if (!fs.existsSync(bin)) throw new Error('not built — run npm run build:helper');
    const result = spawnSync('codesign', ['-dv', path.join(root, 'helper/dist/Purpur Helper.app')], {
      encoding: 'utf8'
    });
    const info = `${result.stderr || ''}${result.stdout || ''}`;
    return info.includes('Signature') ? 'ad-hoc signed' : 'built';
  });

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
