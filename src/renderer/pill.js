'use strict';

const pill = document.getElementById('pill');
const titleEl = document.getElementById('title');
const textEl = document.getElementById('text');
const meterBars = Array.from(document.querySelectorAll('#meter span'));

const TITLES = {
  idle: 'Ready',
  listening: 'Listening…',
  processing: 'Transcribing…',
  cleanup: 'Polishing…',
  inserting: 'Typing…',
  inserted: 'Inserted',
  error: 'Something went wrong'
};

let capture = null;
let soundCache = {};
let settings = { sounds: true, soundVolume: 0.5 };

const WORKLET_SOURCE = `
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('purpur-pcm', PCMProcessor);
`;

function setLevel(level) {
  const clamped = Math.max(0, Math.min(1, level));
  meterBars.forEach((bar, i) => {
    const weight = 1 - i * 0.16;
    const h = 6 + clamped * weight * 20;
    bar.style.height = `${h}px`;
  });
}

async function playSound(name) {
  if (!settings.sounds) return;
  try {
    if (!soundCache[name]) {
      const file = await window.purpur.assetPath(`${name}.wav`);
      soundCache[name] = new Audio(`file://${file}`);
    }
    const audio = soundCache[name].cloneNode();
    audio.volume = settings.soundVolume;
    audio.play().catch(() => {});
  } catch {}
}

async function startCapture() {
  if (capture) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true }
  });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  const analysis = ctx.createAnalyser();
  analysis.fftSize = 512;
  const workletBlob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  const workletUrl = URL.createObjectURL(workletBlob);
  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, 'purpur-pcm');
  const data = new Uint8Array(analysis.frequencyBinCount);

  node.port.onmessage = (event) => {
    const floats = event.data;
    const pcm = new Int16Array(floats.length);
    for (let i = 0; i < floats.length; i++) {
      const s = Math.max(-1, Math.min(1, floats[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    window.purpur.sendAudioChunk(pcm.buffer);
    analysis.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    setLevel(sum / data.length / 128);
  };

  source.connect(analysis);
  source.connect(node);
  node.connect(ctx.destination);
  capture = { stream, ctx, node, workletUrl };
}

async function stopCapture() {
  if (!capture) return;
  try {
    capture.node.port.onmessage = null;
    capture.node.disconnect();
    await capture.ctx.close();
    capture.stream.getTracks().forEach((t) => t.stop());
    URL.revokeObjectURL(capture.workletUrl);
  } catch {}
  capture = null;
  setLevel(0);
  window.purpur.sendAudioEnded();
}

window.purpur.onCaptureCommand((action) => {
  if (action === 'start') startCapture().catch((err) => console.error('capture start failed', err));
  else stopCapture();
});

window.purpur.onState((payload) => {
  pill.className = `pill ${payload.phase}`;
  titleEl.textContent = TITLES[payload.phase] || payload.phase;
  if (payload.phase === 'error') textEl.textContent = payload.message || 'unknown error';
  else if (payload.text) textEl.textContent = payload.text;
  else if (payload.phase === 'listening') textEl.textContent = 'speak now';
  if (payload.sfx) playSound(payload.sfx);
});

window.purpur.onPartial((text) => {
  if (pill.classList.contains('listening')) textEl.textContent = text;
});

window.purpur.onLevel((level) => setLevel(level));

window.purpur.getSettings().then((s) => {
  settings = s;
});
