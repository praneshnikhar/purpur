'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

function pcmToWav(pcm, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function writeTempWav(pcm) {
  const file = path.join(os.tmpdir(), `purpur-${Date.now()}.wav`);
  fs.writeFileSync(file, pcmToWav(pcm));
  return file;
}

async function transcribeOpenAI(settings, pcm, log) {
  const wav = writeTempWav(pcm);
  try {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(wav)], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', settings.sttModel);
    form.append('response_format', 'json');
    if (settings.sttLanguage) form.append('language', settings.sttLanguage);
    const res = await fetch(`${settings.sttBaseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.sttApiKey}` },
      body: form
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`STT ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    return (data.text || '').trim();
  } finally {
    fs.rmSync(wav, { force: true });
  }
}

function whisperArgsFrom(settings, wav) {
  const base = (settings.whisperArgs || '-m {model} -f {wav} -nt').trim().split(/\s+/);
  return base
    .map((a) =>
      a
        .replaceAll('{wav}', wav)
        .replaceAll('{model}', settings.whisperModel || '')
    )
    .filter((a) => a !== '');
}

async function transcribeWhisper(settings, pcm) {
  if (!settings.whisperBinary) throw new Error('whisper binary path is not set');
  const wav = writeTempWav(pcm);
  try {
    const args = whisperArgsFrom(settings, wav);
    const out = await new Promise((resolve, reject) => {
      execFile(settings.whisperBinary, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
    return out
      .split('\n')
      .map((l) => l.replace(/\[[\d:.\s\->]+\]/g, '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
  } finally {
    fs.rmSync(wav, { force: true });
  }
}

async function transcribe(settings, pcm, log) {
  if (!pcm || pcm.length < 3200) return '';
  switch (settings.provider) {
    case 'mock':
      return `purpur test transcript ${new Date().toISOString()} (mock provider, ${(pcm.length / 32000).toFixed(1)}s of audio)`;
    case 'openai':
      return transcribeOpenAI(settings, pcm, log);
    case 'whisper':
      return transcribeWhisper(settings, pcm);
    default:
      throw new Error(`unknown provider: ${settings.provider}`);
  }
}

function applyDictionary(text, dictionary) {
  let out = text;
  for (const entry of dictionary) {
    if (!entry || !entry.from) continue;
    const pattern = new RegExp(`\\b${entry.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(pattern, entry.to || entry.from);
  }
  return out;
}

module.exports = { transcribe, pcmToWav, applyDictionary };
