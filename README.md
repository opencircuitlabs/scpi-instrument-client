# SCPI Instrument Client

A transport-neutral Standard Commands for Programmable Instruments client for power supplies, oscilloscopes, meters, loads, signal generators, and test fixtures.

The package provides safe command construction, typed response parsing, IEEE 488.2 definite-length binary blocks, waveform decoding, serialized request handling, standard common commands, error-queue draining, history, and a deterministic mock transport.

## Quick start

```bash
npm install
npm test
node src/cli.js build MEASure:VOLTage --query
node src/cli.js parse '3.3,"CH1",ON'
```

```js
import { ScpiClient } from '@opencircuitlabs/scpi-instrument-client';

const client = new ScpiClient(tcpOrSerialTransport, {
  terminator: '\n',
  timeoutMs: 2000,
  maxResponseBytes: 64 * 1024 * 1024
});

const id = await client.identify();
await client.write('SOURce:VOLTage', [3.3]);
const volts = await client.queryScalar('MEASure:VOLTage');
const waveform = await client.queryBinary('WAVeform:DATA', [], {
  type: 'int16', endian: 'little', scale: 0.001
});
const errors = await client.drainErrors();
```

## Transport contract

A transport implements:

```js
await transport.write(buffer);
const response = await transport.read({ timeoutMs, binary, maxBytes });
```

This small boundary works over TCP sockets, USBTMC, VISA bridges, serial sessions, or test doubles. `ScpiClient` serializes calls in submission order so responses cannot cross between concurrent callers.

## Command and response safety

Command paths are validated and cannot contain newlines or arbitrary separators. Arguments support finite numbers, integers, booleans (`ON`/`OFF`), symbols, and correctly escaped quoted strings. Queries may use an explicit trailing `?` or the typed query methods.

Response helpers parse:

- finite decimal and scientific-notation numbers;
- booleans and quoted strings;
- comma-separated lists with quoted commas;
- standard `code,"message"` error queue entries;
- definite-length binary blocks with exact length and trailing-byte checks;
- signed/unsigned 8/16/32-bit and 32/64-bit floating values with endianness, scale, and offset.

The client enforces maximum response size before application-level decoding. Indefinite blocks are intentionally rejected because their termination is transport-dependent.

## Standard operations

Convenience methods cover `*IDN?`, `*RST`, `*CLS`, `*OPC?`, and bounded `SYSTem:ERRor?` draining. The history records command, response size, and duration without storing potentially large or sensitive payloads.

## License

MIT
