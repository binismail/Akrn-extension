/**
 * ARKN — Pipeline Unit Tests
 * Tests for merger, scorer, policy, and tokenizer individually.
 * Run with: node tests/pipeline.test.js
 */

const assert = require('assert');

globalThis.window = globalThis;
require('../src/engines/candidate.js');
require('../src/engines/detectors/name.js'); // needed for scorer (COMMON_NAMES)
require('../src/engines/merger.js');
require('../src/engines/scorer.js');
require('../src/engines/policy.js');
require('../src/engines/tokenizer.js');

const pipeline = globalThis.__ARKN_PIPELINE__;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${e.message}`);
    failed++;
  }
}

// ─── Candidate Factory ────────────────────────────────────────────────────────
console.log('\n🏗️  Candidate Factory\n');

test('createCandidate returns correct shape', () => {
  const c = pipeline.createCandidate(0, 5, 'hello', 'NAME', 0.85, 'dict-name');
  assert.strictEqual(c.start, 0);
  assert.strictEqual(c.end, 5);
  assert.strictEqual(c.text, 'hello');
  assert.strictEqual(c.type, 'NAME');
  assert.strictEqual(c.confidence, 0.85);
  assert.strictEqual(c.detector, 'dict-name');
});

// ─── Merger ───────────────────────────────────────────────────────────────────
console.log('\n🔀  Merger\n');

test('empty array', () => {
  assert.deepStrictEqual(pipeline.merge([]), []);
});

test('single candidate passes through', () => {
  const c = pipeline.createCandidate(0, 5, 'James', 'NAME', 0.85, 'dict-name');
  assert.deepStrictEqual(pipeline.merge([c]), [c]);
});

test('non-overlapping candidates preserved', () => {
  const a = pipeline.createCandidate(0, 5, 'James', 'NAME', 0.85, 'dict-name');
  const b = pipeline.createCandidate(10, 25, 'test@example.com', 'EMAIL', 1.0, 'regex-email');
  const result = pipeline.merge([a, b]);
  assert.strictEqual(result.length, 2);
});

test('exact same span — higher confidence wins', () => {
  const a = pipeline.createCandidate(0, 5, 'James', 'NAME', 0.78, 'context-verb');
  const b = pipeline.createCandidate(0, 5, 'James', 'NAME', 0.85, 'dict-name');
  const result = pipeline.merge([a, b]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].confidence, 0.85);
});

test('overlapping spans — longer span wins', () => {
  const name = pipeline.createCandidate(8, 22, 'Alpha Chambers', 'NAME', 0.92, 'context-intro');
  const org = pipeline.createCandidate(8, 26, 'Alpha Chambers LLP', 'ORG', 0.90, 'regex-org');
  const result = pipeline.merge([name, org]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'ORG');
  assert.strictEqual(result[0].end, 26);
});

test('overlapping same-length — higher confidence wins', () => {
  const a = pipeline.createCandidate(0, 10, 'Alpha Beta', 'NAME', 0.80, 'context-social');
  const b = pipeline.createCandidate(0, 10, 'Alpha Beta', 'ORG', 0.95, 'regex-org');
  const result = pipeline.merge([a, b]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].confidence, 0.95);
});

// ─── Scorer ───────────────────────────────────────────────────────────────────
console.log('\n📊  Scorer\n');

test('rigid PII stays at 1.0', () => {
  const c = pipeline.createCandidate(0, 15, 'test@example.com', 'EMAIL', 1.0, 'regex-email');
  const result = pipeline.score([c], 'test@example.com');
  assert.strictEqual(result[0].confidence, 1.0);
});

test('dictionary name gets boosted', () => {
  const c = pipeline.createCandidate(0, 5, 'James', 'NAME', 0.78, 'context-verb');
  const result = pipeline.score([c], 'tell James about the meeting');
  assert.ok(result[0].confidence > 0.78, `Expected boost, got ${result[0].confidence}`);
});

test('repeated name gets boosted', () => {
  const text = 'James went home. Then James came back.';
  const c = pipeline.createCandidate(0, 5, 'James', 'NAME', 0.85, 'dict-name');
  const result = pipeline.score([c], text);
  assert.ok(result[0].confidence > 0.85, `Expected boost for repeated name, got ${result[0].confidence}`);
});

test('confidence capped at 1.0', () => {
  const c = pipeline.createCandidate(0, 5, 'James', 'NAME', 0.95, 'context-honorific');
  const result = pipeline.score([c], 'James James James');
  assert.ok(result[0].confidence <= 1.0);
});

// ─── Policy ───────────────────────────────────────────────────────────────────
console.log('\n🛡️  Policy\n');

test('candidates above threshold pass', () => {
  const c = pipeline.createCandidate(0, 5, 'James', 'NAME', 0.85, 'dict-name');
  const result = pipeline.applyPolicy([c]);
  assert.strictEqual(result.length, 1);
});

test('candidates below threshold rejected', () => {
  const c = pipeline.createCandidate(0, 5, 'maybe', 'NAME', 0.30, 'low-signal');
  const result = pipeline.applyPolicy([c]);
  assert.strictEqual(result.length, 0);
});

test('custom threshold respected', () => {
  const c = pipeline.createCandidate(0, 5, 'James', 'NAME', 0.85, 'dict-name');
  const strict = pipeline.applyPolicy([c], { threshold: 0.95 });
  assert.strictEqual(strict.length, 0);
  const loose = pipeline.applyPolicy([c], { threshold: 0.50 });
  assert.strictEqual(loose.length, 1);
});

// ─── Tokenizer ────────────────────────────────────────────────────────────────
console.log('\n🔤  Tokenizer\n');

test('replaces candidates with tokens', () => {
  const text = 'Hello James, email james@test.com';
  const candidates = [
    pipeline.createCandidate(6, 11, 'James', 'NAME', 0.85, 'dict-name'),
    pipeline.createCandidate(19, 33, 'james@test.com', 'EMAIL', 1.0, 'regex-email'),
  ];
  const { redacted, tokens, summary } = pipeline.tokenize(text, candidates, {});
  assert.ok(redacted.includes('{NAME_1}'));
  assert.ok(redacted.includes('{EMAIL_1}'));
  assert.strictEqual(tokens.get('{NAME_1}'), 'James');
  assert.strictEqual(tokens.get('{EMAIL_1}'), 'james@test.com');
  assert.strictEqual(summary.NAME, 1);
  assert.strictEqual(summary.EMAIL, 1);
});

test('right-to-left replacement preserves offsets', () => {
  const text = 'AB CD EF';
  const candidates = [
    pipeline.createCandidate(0, 2, 'AB', 'NAME', 0.85, 'dict-name'),
    pipeline.createCandidate(6, 8, 'EF', 'NAME', 0.85, 'dict-name'),
  ];
  const { redacted } = pipeline.tokenize(text, candidates, {});
  assert.strictEqual(redacted, '{NAME_1} CD {NAME_2}');
});

test('tokenOffsets continue numbering', () => {
  const text = 'Hi Sarah';
  const candidates = [
    pipeline.createCandidate(3, 8, 'Sarah', 'NAME', 0.85, 'dict-name'),
  ];
  const { redacted } = pipeline.tokenize(text, candidates, { NAME: 5 });
  assert.strictEqual(redacted, 'Hi {NAME_6}');
});

test('restore recovers original text', () => {
  const tokens = new Map([
    ['{NAME_1}', 'James'],
    ['{EMAIL_1}', 'j@test.com'],
  ]);
  const restored = pipeline.restore('Hi {NAME_1}, email {EMAIL_1}', tokens);
  assert.strictEqual(restored, 'Hi James, email j@test.com');
});

test('duplicate name text gets same token', () => {
  const text = 'James told James to go';
  const candidates = [
    pipeline.createCandidate(0, 5, 'James', 'NAME', 0.85, 'dict-name'),
    pipeline.createCandidate(11, 16, 'James', 'NAME', 0.85, 'dict-name'),
  ];
  const { redacted, tokens } = pipeline.tokenize(text, candidates, {});
  assert.strictEqual(redacted, '{NAME_1} told {NAME_1} to go');
  assert.strictEqual(tokens.size, 1);
});

// ─── Custom Rules Matching ─────────────────────────────────────────────────────
console.log('\n⚙️  Custom Rules Matching\n');

// Load full pipeline orchestrator
require('../src/engines/pipeline.js');
const engine = globalThis.__ARKN_REGEX__;

test('matches literal custom rule (case-insensitive + boundary)', () => {
  const text = 'Let us deploy Project Athena to prod';
  const policyConfig = {
    customRules: [
      { name: 'PROJECT_ATHENA', type: 'literal', pattern: 'Project Athena', desc: 'Athena project name' }
    ]
  };
  const { redacted, tokens, summary } = engine.redact(text, {}, policyConfig);
  assert.strictEqual(redacted, 'Let us deploy {PROJECT_ATHENA_1} to prod');
  assert.strictEqual(tokens.get('{PROJECT_ATHENA_1}'), 'Project Athena');
  assert.strictEqual(summary.PROJECT_ATHENA, 1);
});

test('matches regex custom rule', () => {
  const text = 'Refer to billing code REF-12345 in accounting';
  const policyConfig = {
    customRules: [
      { name: 'CLIENT_REF_CODE', type: 'regex', pattern: 'REF-[0-9]{5}', desc: 'Reference pattern' }
    ]
  };
  const { redacted, tokens, summary } = engine.redact(text, {}, policyConfig);
  assert.strictEqual(redacted, 'Refer to billing code {CLIENT_REF_CODE_1} in accounting');
  assert.strictEqual(tokens.get('{CLIENT_REF_CODE_1}'), 'REF-12345');
  assert.strictEqual(summary.CLIENT_REF_CODE, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Pipeline unit tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
