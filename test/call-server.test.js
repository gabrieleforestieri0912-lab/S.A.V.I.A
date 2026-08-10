const test = require('node:test');
const assert = require('node:assert');
const { _codec, status, setConfig } = require('../src/call-server.js');

test('codec μ-law round-trip', () => {
  const vals = [0, 1, -1, 100, -100, 1000, -1000, 8000, -8000, 32000, -32000];
  for (const v of vals) {
    const mulaw = _codec.pcm16ToMulaw(new Int16Array([v]));
    const back = _codec.mulawDecodeToPcm16(mulaw.toString('base64'))[0];
    assert.ok(Math.abs(v - back) <= 650, `err ${Math.abs(v - back)} for ${v}`);
  }
});

test('decode 160-byte μ-law chunk gives 160 samples', () => {
  const chunk = Buffer.alloc(160, 0xff).toString('base64');
  const pcm = _codec.mulawDecodeToPcm16(chunk);
  assert.strictEqual(pcm.length, 160);
});

test('status reflects defaults', () => {
  setConfig({});
  const s = status();
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.activeCalls, 0);
  assert.strictEqual(s.port, 8090);
});
