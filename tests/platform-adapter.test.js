/**
 * ARKN — Platform Adapter Tests
 * Tests the ChatGPT adapter's payload parsing (format A and B).
 *
 * Run: node tests/platform-adapter.test.js
 */

'use strict';

// ── Minimal shim to load adapter without a browser environment ───────────────

const window = { __ARKN_ADAPTERS__: {} };
global.window = window;

// Load adapter (it registers on window.__ARKN_ADAPTERS__)
eval(require('fs').readFileSync('src/platforms/chatgpt/adapter.js', 'utf8'));

const adapter = window.__ARKN_ADAPTERS__['chatgpt'];

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg ?? `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\nChatGPT Adapter — Format A (content.parts array)\n');

test('extracts user messages from content.parts format', () => {
  const parsed = {
    messages: [
      { author: { role: 'user' }, content: { parts: ['Hello my email is test@example.com'] } },
      { author: { role: 'assistant' }, content: { parts: ['I see you.'] } },
    ],
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 1, 'Should only return user messages');
  assertEqual(msgs[0].getText()[0], 'Hello my email is test@example.com');
});

test('ignores non-string parts (image objects etc)', () => {
  const parsed = {
    messages: [
      {
        author: { role: 'user' },
        content: { parts: ['Hello', { type: 'image_url', url: 'data:...' }] },
      },
    ],
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs[0].getText().length, 1, 'Should only return string parts');
  assertEqual(msgs[0].getText()[0], 'Hello');
});

test('setText writes redacted parts back correctly (Format A)', () => {
  const parsed = {
    messages: [
      { author: { role: 'user' }, content: { parts: ['My email is test@example.com and my name is John'] } },
    ],
  };
  const msgs = adapter.extractUserMessages(parsed);
  msgs[0].setText(['My email is {EMAIL_1} and my name is {NAME_1}']);
  assertEqual(
    parsed.messages[0].content.parts[0],
    'My email is {EMAIL_1} and my name is {NAME_1}',
    'Should write redacted text back to original parsed object'
  );
});

test('preserves non-string parts when writing back (Format A)', () => {
  const imgObj = { type: 'image_url', url: 'data:...' };
  const parsed = {
    messages: [
      { author: { role: 'user' }, content: { parts: ['My email is test@example.com', imgObj] } },
    ],
  };
  const msgs = adapter.extractUserMessages(parsed);
  msgs[0].setText(['My email is [EMAIL_1]']);
  assertEqual(parsed.messages[0].content.parts[0], 'My email is [EMAIL_1]');
  assert(parsed.messages[0].content.parts[1] === imgObj, 'Image object should be preserved as-is');
});

test('handles multiple user turns', () => {
  const parsed = {
    messages: [
      { author: { role: 'user' }, content: { parts: ['First message'] } },
      { author: { role: 'assistant' }, content: { parts: ['Response'] } },
      { author: { role: 'user' }, content: { parts: ['Second message'] } },
    ],
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 2, 'Should return both user turns');
  assertEqual(msgs[0].getText()[0], 'First message');
  assertEqual(msgs[1].getText()[0], 'Second message');
});

console.log('\nChatGPT Adapter — Format B (legacy plain string content)\n');

test('extracts user messages from legacy string format', () => {
  const parsed = {
    messages: [
      { role: 'user', content: 'My NI number is AB123456C' },
      { role: 'assistant', content: 'Got it.' },
    ],
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 1);
  assertEqual(msgs[0].getText()[0], 'My NI number is AB123456C');
});

test('setText writes back to legacy string content', () => {
  const parsed = {
    messages: [
      { role: 'user', content: 'My NI number is AB123456C' },
    ],
  };
  const msgs = adapter.extractUserMessages(parsed);
  msgs[0].setText(['My NI number is [NINO_1]']);
  assertEqual(parsed.messages[0].content, 'My NI number is [NINO_1]');
});

console.log('\nChatGPT Adapter — Edge cases\n');

test('returns empty array for empty messages', () => {
  const msgs = adapter.extractUserMessages({ messages: [] });
  assertEqual(msgs.length, 0);
});

test('returns empty array when messages key is missing', () => {
  const msgs = adapter.extractUserMessages({});
  assertEqual(msgs.length, 0);
});

test('skips messages with unsupported content format (object)', () => {
  const parsed = {
    messages: [
      { author: { role: 'user' }, content: { type: 'function_call', name: 'get_weather' } },
    ],
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 0, 'Should skip messages with unrecognised content format');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Platform adapter tests: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
