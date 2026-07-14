/**
 * ARKN — Google Gemini Platform Adapter Tests
 * Run with: node tests/gemini-adapter.test.js
 */

const assert = require('assert');

// Load adapter
globalThis.window = globalThis;
require('../src/platforms/gemini/config.js');
require('../src/platforms/gemini/adapter.js');

const adapter = globalThis.__ARKN_ADAPTERS__['gemini'];
assert.ok(adapter, 'Gemini adapter should be registered');

console.log('\n♊  Google Gemini Adapter Tests\n');

// Sample batchexecute form body based on actual network trace
const sampleRawBody = 'f.req=' + encodeURIComponent(JSON.stringify([
  null,
  JSON.stringify([
    ["Hey Gemini, my name is Khalid", 0, null, null, null, null, 0],
    ["en"],
    ["c_829719da5fcd3b99", "r_a06093d96430be2b", "rc_f6605a64648d246a"]
  ])
])) + '&at=AD1_LW4I_HMS61ioYRgcKT0YCo1';

// Test parse
const parsed = adapter.parse(sampleRawBody);
assert.ok(parsed, 'Adapter should parse form data');
assert.ok(parsed.fReq, 'Parsed payload should contain fReq array');

// Test extractUserMessages
const msgs = adapter.extractUserMessages(parsed);
assert.ok(msgs.length >= 1, 'Should extract user message slots');
const targetMsg = msgs.find(m => m.getText()[0] === 'Hey Gemini, my name is Khalid');
assert.ok(targetMsg, 'Should find prompt message slot');

// Test setText modification
targetMsg.setText(['Hey Gemini, my name is {NAME_1}']);


// Test serialize
const serialized = adapter.serialize(parsed);
assert.ok(decodeURIComponent(serialized).includes('{NAME_1}'), 'Serialized output should contain redacted token');
assert.ok(serialized.startsWith('f.req='), 'Serialized output should preserve form parameter key');

console.log('✅ Gemini adapter tests passed successfully!');
