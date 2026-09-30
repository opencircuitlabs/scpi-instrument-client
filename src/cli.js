#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { buildCommand, decodeBinaryValues, encodeDefiniteBlock, parseDefiniteBlock, parseList, parseScalar } from './index.js';

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'build') console.log(buildCommand(args[0], args.slice(1).filter((arg) => arg !== '--query').map(parseScalar), { query: args.includes('--query') }));
  else if (command === 'parse') console.log(JSON.stringify(parseList(args.join(' ')), null, 2));
  else if (command === 'block-encode') process.stdout.write(encodeDefiniteBlock(readFileSync(args[0])));
  else if (command === 'block-inspect') { const block = parseDefiniteBlock(readFileSync(args[0])); console.log(JSON.stringify({ bytes: block.payload.length, consumedBytes: block.consumedBytes, trailingBytes: block.trailingBytes }, null, 2)); }
  else if (command === 'binary-decode') { const block = parseDefiniteBlock(readFileSync(args[0])); console.log(JSON.stringify(decodeBinaryValues(block.payload, { type: args[1] ?? 'float32', endian: args[2] ?? 'big' }))); }
  else throw new Error('Usage: scpi-tool <build|parse|block-encode|block-inspect|binary-decode> ...');
} catch (error) { console.error(error.message); process.exitCode = 1; }
