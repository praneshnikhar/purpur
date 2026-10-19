'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ASSETS = path.join(__dirname, '..', 'assets');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(file, width, height, painter) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = painter(x, y);
      const i = rowStart + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

function roundedRectAlpha(x, y, w, h, radius, px, py) {
  const dx = Math.max(radius - px, px - (w - radius), 0);
  const dy = Math.max(radius - py, py - (h - radius), 0);
  if (dx === 0 || dy === 0) return 1;
  const dist = Math.hypot(dx, dy);
  return Math.max(0, Math.min(1, radius - dist + 0.5));
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function generateIcons() {
  const PURPLE_TOP = [155, 110, 250];
  const PURPLE_BOTTOM = [96, 42, 190];
  const WHITE = [255, 255, 255];

  writePng(path.join(ASSETS, 'icon.png'), 256, 256, (x, y) => {
    const a = roundedRectAlpha(x, y, 256, 256, 58, x, y);
    if (a <= 0) return [0, 0, 0, 0];
    let color = mix(PURPLE_TOP, PURPLE_BOTTOM, y / 255);
    const cx = 128;
    const capsuleHalfW = 26;
    const capsuleTop = 62;
    const capsuleBottom = 150;
    const inCapsule = Math.abs(x - cx) <= capsuleHalfW && y >= capsuleTop && y <= capsuleBottom;
    const inCapsuleCap =
      Math.hypot(x - cx, y - capsuleTop) <= capsuleHalfW || Math.hypot(x - cx, y - capsuleBottom) <= capsuleHalfW;
    const inStem = Math.abs(x - cx) <= 8 && y >= 160 && y <= 196;
    const arcR = 62;
    const inArc =
      y >= 118 &&
      y <= 160 &&
      Math.abs(Math.hypot(x - cx, y - 118) - arcR) <= 9;
    if ((inCapsule && inCapsuleCap) || inStem || (inArc && (inCapsule || x !== cx))) {
      color = WHITE;
    }
    return [color[0], color[1], color[2], Math.round(a * 255)];
  });

  writePng(path.join(ASSETS, 'trayTemplate.png'), 18, 18, (x, y) => {
    const r = 6.2;
    const d = Math.hypot(x - 8.5, y - 8.5);
    const a = Math.max(0, Math.min(1, r - d + 0.5));
    if (a <= 0) return [0, 0, 0, 0];
    return [0, 0, 0, Math.round(a * 255)];
  });
}

function writeWav(file, sampleRate, samples) {
  const header = Buffer.alloc(44);
  const dataLength = samples.length * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  const pcm = Buffer.alloc(dataLength);
  samples.forEach((s, i) => {
    const v = Math.max(-1, Math.min(1, s));
    pcm.writeInt16LE(Math.round(v * 32767 * 0.85), i * 2);
  });
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}

function tone(sampleRate, durationMs, segments) {
  const total = Math.round((sampleRate * durationMs) / 1000);
  const out = new Float32Array(total);
  let offset = 0;
  for (const seg of segments) {
    const len = Math.round((sampleRate * seg.ms) / 1000) || total;
    for (let i = 0; i < len && offset + i < total; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, i / (sampleRate * 0.012)) * Math.min(1, (len - i) / (sampleRate * 0.05));
      out[offset + i] = Math.sin(2 * Math.PI * seg.hz * t) * env;
    }
    offset += len;
  }
  return Array.from(out);
}

function generateSounds() {
  const rate = 44100;
  writeWav(path.join(ASSETS, 'start.wav'), rate, tone(rate, 120, [{ hz: 660, ms: 60 }, { hz: 880, ms: 60 }]));
  writeWav(path.join(ASSETS, 'stop.wav'), rate, tone(rate, 120, [{ hz: 520, ms: 120 }]));
  writeWav(path.join(ASSETS, 'done.wav'), rate, tone(rate, 170, [{ hz: 660, ms: 70 }, { hz: 990, ms: 100 }]));
  writeWav(
    path.join(ASSETS, 'error.wav'),
    rate,
    tone(rate, 300, [{ hz: 240, ms: 100 }, { hz: 0, ms: 60 }, { hz: 200, ms: 100 }])
  );
}

fs.mkdirSync(ASSETS, { recursive: true });
generateIcons();
generateSounds();
console.log(`assets written to ${ASSETS}`);
