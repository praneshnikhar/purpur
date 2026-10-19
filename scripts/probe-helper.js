'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const bin = path.join(__dirname, '..', 'helper', 'dist', 'Purpur Helper.app', 'Contents', 'MacOS', 'purpur-helper');
const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });

let buffer = '';
let step = 0;
const seen = [];
let nextId = 1;

function send(obj) {
  child.stdin.write(`${JSON.stringify(obj)}\n`);
}

function fail(message) {
  console.log(`FAIL ${message}`);
  child.kill();
  process.exit(1);
}

const timeout = setTimeout(() => fail('helper probe timed out'), 15000);

child.on('error', (err) => fail(err.message));
child.stderr.on('data', (d) => console.log(`[helper stderr] ${d.toString().trim()}`));

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    seen.push(msg);
    console.log(`helper -> ${JSON.stringify(msg)}`);
    if (msg.type === 'event' && msg.event === 'ready') {
      console.log(`PASS  helper ready (accessibility=${msg.permissions.accessibility}, inputMonitoring=${msg.permissions.inputMonitoring})`);
      send({ cmd: 'set-trigger', trigger: 'fn-doubletap', id: nextId++ });
    } else if (msg.type === 'ack' && step === 0) {
      step = 1;
      if (msg.trigger !== 'fn-doubletap') fail(`trigger not applied: ${msg.trigger}`);
      console.log('PASS  trigger switch acknowledged');
      send({ cmd: 'context', id: nextId++ });
    } else if (msg.type === 'context' && step === 1) {
      step = 2;
      console.log(`PASS  context response keys: ${Object.keys(msg.context || {}).join(', ')}`);
      send({ cmd: 'permissions', id: nextId++ });
    } else if (msg.type === 'permissions' && step === 2) {
      step = 3;
      console.log('PASS  permissions response received');
      send({ cmd: 'quit', id: nextId++ });
    } else if (msg.type === 'bye') {
      clearTimeout(timeout);
      console.log('PASS  clean shutdown');
      console.log(`\n${seen.length} messages, probe complete`);
      child.stdin.end();
      setTimeout(() => process.exit(0), 300);
    }
  }
});
