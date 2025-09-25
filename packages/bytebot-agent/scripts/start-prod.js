#!/usr/bin/env node
const { existsSync } = require('fs');
const path = require('path');

const baseDist = path.resolve(__dirname, '..', 'dist');
const candidates = [
  'src/main.js',
  'bytebot-agent/src/main.js',
  'main.js',
];

for (const rel of candidates) {
  const candidatePath = path.join(baseDist, rel);
  if (existsSync(candidatePath)) {
    require(candidatePath);
    return;
  }
}

console.error('Unable to locate a compiled Nest entrypoint under dist/. Searched:', candidates);
process.exit(1);
