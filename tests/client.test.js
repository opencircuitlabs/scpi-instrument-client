import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommand, decodeBinaryValues, encodeDefiniteBlock, formatArgument, MockScpiTransport, parseDefiniteBlock, parseError, parseList, parseScalar, ScpiClient } from '../src/index.js';

test('command builder validates paths and formats typed arguments', () => {
  assert.equal(buildCommand('SOURce:VOLTage', [3.3, true, 'CH 1']), 'SOURce:VOLTage 3.3,ON,"CH 1"'); assert.equal(buildCommand(':MEASure:VOLTage', [], { query:true }), ':MEASure:VOLTage?'); assert.equal(buildCommand('*IDN?'), '*IDN?'); assert.throws(() => buildCommand('OUTP\n*RST'), /Invalid/);
});
test('argument formatting escapes quotes and rejects non-finite numbers', () => {
  assert.equal(formatArgument('say "hi"'), '"say ""hi"""'); assert.throws(() => formatArgument(Infinity), /finite/);
});
test('scalar and list parsers retain quoted commas and typed values', () => {
  assert.equal(parseScalar('1.25E-3'), 0.00125); assert.equal(parseScalar('ON'), true); assert.deepEqual(parseList('1,"hello, world",OFF'), [1,'hello, world',false]);
});
test('SCPI errors parse code and escaped messages', () => {
  assert.deepEqual(parseError('-113,"Undefined header"'), { code:-113, message:'Undefined header', ok:false }); assert.equal(parseError('0,"No error"').ok, true);
});
test('definite binary blocks round trip arbitrary bytes', () => {
  const payload = Buffer.from([0,1,2,0xff]); const encoded = Buffer.concat([encodeDefiniteBlock(payload), Buffer.from('\n')]); const parsed = parseDefiniteBlock(encoded); assert.deepEqual(parsed.payload, payload); assert.equal(parsed.trailingBytes, 1);
});
test('binary block parser rejects indefinite, truncated, and trailing garbage', () => {
  assert.throws(() => parseDefiniteBlock(Buffer.from('#0abc')), /Unsupported/); assert.throws(() => parseDefiniteBlock(Buffer.from('#210abc')), /Truncated/); assert.throws(() => parseDefiniteBlock(Buffer.from('#13abcX')), /Unexpected/);
});
test('binary values support endian, signedness, floating point, scale, and offset', () => {
  const words = Buffer.alloc(4); words.writeInt16LE(-2,0); words.writeInt16LE(4,2); assert.deepEqual(decodeBinaryValues(words, { type:'int16', endian:'little', scale:0.5, offset:1 }), [0,3]); const floats = Buffer.alloc(4); floats.writeFloatBE(1.5); assert.deepEqual(decodeBinaryValues(floats), [1.5]);
});
test('client queries scalars, lists, and identification', async () => {
  const transport = new MockScpiTransport(['3.300\n','1,2,3\n','OpenCircuit,Scope,000123,1.2\n']); const client = new ScpiClient(transport); assert.equal(await client.queryScalar('MEASure:VOLTage'), 3.3); assert.deepEqual(await client.queryList('TRACe:DATA'), [1,2,3]); assert.deepEqual(await client.identify(), { manufacturer:'OpenCircuit', model:'Scope', serialNumber:'000123', firmware:'1.2', raw:['OpenCircuit','Scope','000123','1.2'] }); assert.equal(transport.writes[0].toString(), 'MEASure:VOLTage?\n');
});
test('binary query decodes a definite block', async () => {
  const data = Buffer.alloc(4); data.writeUInt16BE(100,0); data.writeUInt16BE(200,2); const transport = new MockScpiTransport([encodeDefiniteBlock(data)]); const client = new ScpiClient(transport); assert.deepEqual(await client.queryBinary('WAVeform:DATA', [], { type:'uint16' }), [100,200]);
});
test('error queue drains until no-error sentinel', async () => {
  const transport = new MockScpiTransport(['-113,"Undefined header"\n','-222,"Data out of range"\n','0,"No error"\n']); const client = new ScpiClient(transport); const errors = await client.drainErrors(); assert.deepEqual(errors.map((x)=>x.code), [-113,-222]); assert.equal(transport.assertComplete(), true);
});
test('concurrent calls remain serialized in submission order', async () => {
  const transport = new MockScpiTransport(['1\n','2\n']); const client = new ScpiClient(transport); const values = await Promise.all([client.queryScalar('MEASure:A'), client.queryScalar('MEASure:B')]); assert.deepEqual(values,[1,2]); assert.equal(transport.maxConcurrentReads,1); assert.deepEqual(transport.writes.map((x)=>x.toString().trim()), ['MEASure:A?','MEASure:B?']);
});
test('response size and missing mock data fail clearly', async () => {
  const client = new ScpiClient(new MockScpiTransport(['toolong']), { maxResponseBytes: 3 }); await assert.rejects(client.query('READ'), /maxBytes/); const empty = new ScpiClient(new MockScpiTransport()); await assert.rejects(empty.query('READ'), /No mock/);
});
