const PATH = /^(?:\*[A-Za-z]+|:?[A-Za-z][A-Za-z0-9]*(?::[A-Za-z][A-Za-z0-9]*)*)$/;
const asBuffer = (data) => Buffer.isBuffer(data) ? data : Buffer.from(data);

export function formatArgument(value) {
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('SCPI numeric argument must be finite'); return String(value); }
  if (typeof value === 'bigint') return value.toString();
  if (value == null) throw new Error('SCPI arguments cannot be null');
  const text = String(value); if (/^[A-Za-z0-9_.+%-]+$/.test(text)) return text; return `"${text.replaceAll('"', '""')}"`;
}
export function buildCommand(path, args = [], options = {}) { const markedQuery = path.endsWith('?'); const cleanPath = markedQuery ? path.slice(0, -1) : path; if (!PATH.test(cleanPath)) throw new Error(`Invalid SCPI path: ${path}`); if (!Array.isArray(args)) args = [args]; const query = options.query ?? markedQuery; if (markedQuery && options.query === false) throw new Error('Query marker conflicts with query=false'); const base = query ? `${cleanPath}?` : cleanPath; return `${base}${args.length ? ` ${args.map(formatArgument).join(',')}` : ''}`; }

function splitList(text) { const items = []; let item = ''; let quoted = false; for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '"') { if (quoted && text[i + 1] === '"') { item += '"'; i++; } else quoted = !quoted; } else if (c === ',' && !quoted) { items.push(item.trim()); item = ''; } else item += c; } if (quoted) throw new Error('Unterminated SCPI quoted string'); items.push(item.trim()); return items; }
export function parseScalar(value) { const text = Buffer.isBuffer(value) ? value.toString('utf8').trim() : String(value).trim(); if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(text)) return Number(text); if (/^(?:ON|TRUE)$/i.test(text)) return true; if (/^(?:OFF|FALSE)$/i.test(text)) return false; if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1).replaceAll('""', '"'); return text; }
export function parseList(value) { return splitList(Buffer.isBuffer(value) ? value.toString('utf8').trim() : String(value).trim()).map(parseScalar); }
export function parseError(value) { const fields = splitList(Buffer.isBuffer(value) ? value.toString('utf8').trim() : String(value).trim()); const code = Number(fields[0]); if (!Number.isInteger(code) || fields.length < 2) throw new Error(`Malformed SCPI error response: ${value}`); return { code, message: parseScalar(fields.slice(1).join(',')), ok: code === 0 }; }

export function encodeDefiniteBlock(payload) { const data = asBuffer(payload); const length = String(data.length); if (length.length > 9) throw new Error('SCPI block length exceeds 9 digits'); return Buffer.concat([Buffer.from(`#${length.length}${length}`), data]); }
export function parseDefiniteBlock(input, options = {}) { const data = asBuffer(input); if (data[0] !== 0x23) throw new Error('SCPI block must begin with #'); const digits = data[1] - 48; if (!Number.isInteger(digits) || digits < 1 || digits > 9) throw new Error('Unsupported or invalid SCPI block length header'); if (data.length < 2 + digits) throw new Error('Truncated SCPI block length'); const lengthText = data.subarray(2, 2 + digits).toString('ascii'); if (!/^\d+$/.test(lengthText)) throw new Error('Invalid SCPI block length digits'); const length = Number(lengthText); const payloadStart = 2 + digits; if (data.length < payloadStart + length) throw new Error(`Truncated SCPI block payload: expected ${length} bytes`); const trailing = data.subarray(payloadStart + length); if (!options.allowTrailingTerminator && trailing.length && !trailing.equals(Buffer.from('\n')) && !trailing.equals(Buffer.from('\r\n'))) throw new Error('Unexpected bytes after SCPI block'); return { payload: data.subarray(payloadStart, payloadStart + length), consumedBytes: payloadStart + length, trailingBytes: trailing.length };
}

export function decodeBinaryValues(payload, options = {}) { const data = asBuffer(payload); const type = options.type ?? 'float32'; const endian = options.endian ?? 'big'; const TYPES = { int8: [1, 'readInt8'], uint8: [1, 'readUInt8'], int16: [2, endian === 'little' ? 'readInt16LE' : 'readInt16BE'], uint16: [2, endian === 'little' ? 'readUInt16LE' : 'readUInt16BE'], int32: [4, endian === 'little' ? 'readInt32LE' : 'readInt32BE'], uint32: [4, endian === 'little' ? 'readUInt32LE' : 'readUInt32BE'], float32: [4, endian === 'little' ? 'readFloatLE' : 'readFloatBE'], float64: [8, endian === 'little' ? 'readDoubleLE' : 'readDoubleBE'] }; const descriptor = TYPES[type]; if (!descriptor) throw new Error(`Unsupported binary type: ${type}`); const [width, method] = descriptor; if (data.length % width) throw new Error(`Payload length is not aligned to ${type}`); const scale = options.scale ?? 1; const offset = options.offset ?? 0; return Array.from({ length: data.length / width }, (_, i) => data[method](i * width) * scale + offset); }

export class ScpiClient {
  constructor(transport, options = {}) { if (!transport || typeof transport.write !== 'function' || typeof transport.read !== 'function') throw new Error('transport.write and transport.read are required'); this.transport = transport; this.options = { terminator: '\n', timeoutMs: 2000, maxResponseBytes: 64 * 1024 * 1024, ...options }; this.queue = Promise.resolve(); this.history = []; }
  #enqueue(operation) { const result = this.queue.then(operation, operation); this.queue = result.catch(() => {}); return result; }
  #line(command) { if (/\r|\n/.test(command)) throw new Error('SCPI command cannot contain line breaks'); return Buffer.from(command + this.options.terminator); }
  async write(path, args = [], options = {}) { return this.#enqueue(async () => { const command = buildCommand(path, args, { query: false }); const started = performance.now(); await this.transport.write(this.#line(command)); this.history.push({ type: 'write', command, durationMs: performance.now() - started }); }); }
  async query(path, args = [], options = {}) { return this.#enqueue(async () => { const command = buildCommand(path, args, { query: true }); const started = performance.now(); await this.transport.write(this.#line(command)); const response = await this.transport.read({ timeoutMs: options.timeoutMs ?? this.options.timeoutMs, binary: Boolean(options.binary), maxBytes: this.options.maxResponseBytes }); const data = asBuffer(response); if (data.length > this.options.maxResponseBytes) throw new Error(`SCPI response exceeds ${this.options.maxResponseBytes} bytes`); this.history.push({ type: 'query', command, responseBytes: data.length, durationMs: performance.now() - started }); return options.binary ? parseDefiniteBlock(data, { allowTrailingTerminator: options.allowTrailingTerminator }).payload : data.toString('utf8').replace(/\r?\n$/, ''); }); }
  async queryScalar(path, args, options) { return parseScalar(await this.query(path, args, options)); }
  async queryList(path, args, options) { return parseList(await this.query(path, args, options)); }
  async queryBinary(path, args, options = {}) { const payload = await this.query(path, args, { ...options, binary: true }); return options.type ? decodeBinaryValues(payload, options) : payload; }
  async identify() { const values = splitList(await this.query('*IDN')).map((value) => value.startsWith('"') && value.endsWith('"') ? String(parseScalar(value)) : value.trim()); return { manufacturer: values[0] ?? '', model: values[1] ?? '', serialNumber: values[2] ?? '', firmware: values[3] ?? '', raw: values }; }
  async reset() { await this.write('*RST'); }
  async clearStatus() { await this.write('*CLS'); }
  async operationComplete() { return Boolean(await this.queryScalar('*OPC')); }
  async drainErrors(options = {}) { const errors = []; const limit = options.limit ?? 100; for (let i = 0; i < limit; i++) { const error = parseError(await this.query('SYSTem:ERRor')); if (error.ok) return errors; errors.push(error); } throw new Error(`SCPI error queue did not clear after ${limit} entries`); }
  getHistory() { return structuredClone(this.history); }
}

export class MockScpiTransport {
  constructor(responses = []) { this.responses = responses.map((value) => asBuffer(value)); this.writes = []; this.concurrentReads = 0; this.maxConcurrentReads = 0; }
  async write(data) { this.writes.push(Buffer.from(data)); }
  async read(options = {}) { this.concurrentReads++; this.maxConcurrentReads = Math.max(this.maxConcurrentReads, this.concurrentReads); try { if (!this.responses.length) throw new Error('No mock SCPI response queued'); const response = this.responses.shift(); if (options.maxBytes != null && response.length > options.maxBytes) throw new Error('Mock response exceeds maxBytes'); return Buffer.from(response); } finally { this.concurrentReads--; } }
  assertComplete() { if (this.responses.length) throw new Error(`${this.responses.length} mock responses remain`); return true; }
}
