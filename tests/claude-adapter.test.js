/**
 * ARKN — Claude Platform Adapter Tests
 * Tests Claude's message payload parsing (confirmed format from network inspection).
 *
 * Run: node tests/claude-adapter.test.js
 */

'use strict';

// ── Shim for browser global ──────────────────────────────────────────────────
const window = { __ARKN_ADAPTERS__: {} };
global.window = window;

eval(require('fs').readFileSync('src/platforms/claude/adapter.js', 'utf8'));

const adapter = window.__ARKN_ADAPTERS__['claude'];

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

console.log('\nClaude Adapter — Completion endpoint (Format A: string content)\n');

test('extracts human-role message from completion payload', () => {
  const parsed = {
    messages: [
      { role: 'human', content: 'My email is test@example.com' },
      { role: 'assistant', content: 'I see.' },
    ],
    model: 'claude-sonnet-4-5',
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 1, 'Should only extract human messages');
  assertEqual(msgs[0].getText()[0], 'My email is test@example.com');
});

test('also handles "user" role (API compatibility)', () => {
  const parsed = {
    messages: [{ role: 'user', content: 'Hello from user role' }],
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 1);
  assertEqual(msgs[0].getText()[0], 'Hello from user role');
});

test('setText writes redacted content back (Format A)', () => {
  const parsed = {
    messages: [{ role: 'human', content: 'My NI is AB123456C' }],
  };
  const msgs = adapter.extractUserMessages(parsed);
  msgs[0].setText(['My NI is [NINO_1]']);
  assertEqual(parsed.messages[0].content, 'My NI is [NINO_1]');
});

test('handles multiple human turns', () => {
  const parsed = {
    messages: [
      { role: 'human', content: 'First message' },
      { role: 'assistant', content: 'Reply' },
      { role: 'human', content: 'Second message' },
    ],
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 2);
  assertEqual(msgs[0].getText()[0], 'First message');
  assertEqual(msgs[1].getText()[0], 'Second message');
});

console.log('\nClaude Adapter — Completion endpoint (Format B: content blocks array)\n');

test('extracts text from content block array', () => {
  const parsed = {
    messages: [{
      role: 'human',
      content: [
        { type: 'text', text: 'My email is test@test.com' },
        { type: 'image', source: { type: 'base64', data: '...' } },
      ],
    }],
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 1);
  assertEqual(msgs[0].getText()[0], 'My email is test@test.com');
  assertEqual(msgs[0].getText().length, 1, 'Should only return text blocks');
});

test('setText writes back to text blocks only (preserves image blocks)', () => {
  const imgBlock = { type: 'image', source: { type: 'base64', data: '...' } };
  const parsed = {
    messages: [{
      role: 'human',
      content: [
        { type: 'text', text: 'My name is James' },
        imgBlock,
      ],
    }],
  };
  const msgs = adapter.extractUserMessages(parsed);
  msgs[0].setText(['My name is {NAME_1}']);
  assertEqual(parsed.messages[0].content[0].text, 'My name is {NAME_1}', 'Text block should be redacted');
  assert(parsed.messages[0].content[1] === imgBlock, 'Image block should be preserved');
});

console.log('\nClaude Adapter — Format C: Direct prompt string (CONFIRMED web UI format)\n');

test('extracts text from prompt string payload', () => {
  const parsed = {
    prompt: 'so the name is Khalid what\'s yours?',
    parent_message_uuid: '019f0b04-fe34-742b-910f-5041af02ff33',
    timezone: 'Africa/Lagos',
    locale: 'en-US',
    model: 'claude-sonnet-4-6',
    effort: 'low',
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 1, 'Should extract 1 message from prompt format');
  assertEqual(msgs[0].getText()[0], 'so the name is Khalid what\'s yours?');
});

test('setText writes redacted text back into prompt key', () => {
  const parsed = {
    prompt: 'My email is test@example.com and my NI is AB123456C',
    parent_message_uuid: 'abc-123',
    model: 'claude-sonnet-4-6',
  };
  const msgs = adapter.extractUserMessages(parsed);
  msgs[0].setText(['My email is [EMAIL_1] and my NI is [NINO_1]']);
  assertEqual(parsed.prompt, 'My email is [EMAIL_1] and my NI is [NINO_1]',
    'Redacted text should be written back to parsed.prompt');
});

test('Format C takes priority over empty messages array', () => {
  // If both prompt and messages exist, prompt wins (web UI sends prompt)
  const parsed = {
    prompt: 'Hello from prompt',
    messages: [],
    model: 'claude-sonnet-4-6',
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 1);
  assertEqual(msgs[0].getText()[0], 'Hello from prompt');
});

test('empty prompt string is a no-op', () => {
  const parsed = { prompt: '', model: 'claude-sonnet-4-6' };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 0, 'Empty prompt should not be processed');
});

console.log('\nClaude Adapter — Non-completion endpoints (must be no-ops)\n');


test('returns empty for title endpoint payload (no messages key)', () => {
  const parsed = { message_content: 'hey', recent_titles: [] };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 0, 'Title endpoint must be a no-op');
});

test('returns empty for settings endpoint (no messages key)', () => {
  const msgs = adapter.extractUserMessages({ settings: {}, theme: 'dark' });
  assertEqual(msgs.length, 0);
});

test('returns empty for empty payload', () => {
  const msgs = adapter.extractUserMessages({});
  assertEqual(msgs.length, 0);
});

test('returns empty when messages is not an array', () => {
  const msgs = adapter.extractUserMessages({ messages: 'not an array' });
  assertEqual(msgs.length, 0);
});

test('skips assistant-only messages', () => {
  const parsed = {
    messages: [
      { role: 'assistant', content: 'I am Claude.' },
    ],
  };
  const msgs = adapter.extractUserMessages(parsed);
  assertEqual(msgs.length, 0, 'Assistant messages should not be extracted');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Claude adapter tests: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
