/**
 * ARKN — Pipeline Engine Tests
 * Run with: node tests/regex-engine.test.js
 * Zero dependencies — uses Node's built-in assert module.
 *
 * Loads the full pipeline (candidate → detectors → merger → scorer → policy → tokenizer → pipeline)
 * and validates the same redact/restore API surface.
 */

const assert = require('assert');

// ── Load pipeline modules (adapted for Node — each IIFE writes to globalThis) ─
const { execSync } = require('child_process');

// Simulate `window` for the IIFEs
globalThis.window = globalThis;

// Load in dependency order (same as manifest.json)
require('../src/engines/candidate.js');
require('../src/engines/detectors/email.js');
require('../src/engines/detectors/phone.js');
require('../src/engines/detectors/postcode.js');
require('../src/engines/detectors/nino.js');
require('../src/engines/detectors/drivelic.js');
require('../src/engines/detectors/nhs.js');
require('../src/engines/detectors/bank.js');
require('../src/engines/detectors/claim.js');
require('../src/engines/detectors/name.js');
require('../src/engines/detectors/org.js');
require('../src/engines/merger.js');
require('../src/engines/scorer.js');
require('../src/engines/policy.js');
require('../src/engines/tokenizer.js');
require('../src/engines/pipeline.js');

const engine = globalThis.__ARKN_REGEX__;
assert.ok(engine, 'Engine should be exposed on globalThis.__ARKN_REGEX__');

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

// ── Helper ────────────────────────────────────────────────────────────────────

function assertRedacts(text, expectedToken, description) {
  const { redacted, tokens } = engine.redact(text);
  const hasToken = [...tokens.keys()].some((k) => k.startsWith(`{${expectedToken}_`));
  assert.ok(hasToken, `Expected to find a [${expectedToken}_N] token — got: "${redacted}"`);
}

function assertNotRedacted(text, description) {
  const { tokens } = engine.redact(text);
  assert.strictEqual(tokens.size, 0, `Should NOT redact "${text}" — got ${tokens.size} token(s)`);
}

function roundTrip(text) {
  const { redacted, tokens } = engine.redact(text);
  const restored = engine.restore(redacted, tokens);
  assert.strictEqual(restored, text, `Round-trip failed for: "${text}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n📧  Email\n');

test('standard email', () => assertRedacts('Contact john.doe@example.com today', 'EMAIL'));
test('subdomain email', () => assertRedacts('Reply to support@mail.firm.co.uk', 'EMAIL'));
test('email with + alias', () => assertRedacts('j.doe+legal@chambers.com', 'EMAIL'));
test('email round-trip', () => roundTrip('Please email alice@law.co.uk for details.'));
test('non-email ignored', () => assertNotRedacted('This is a normal sentence.'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n📱  UK Phone Numbers\n');

test('UK mobile (07xxx)', () => assertRedacts('Call me on 07911 123456', 'PHONE'));
test('UK mobile +44', ()    => assertRedacts('+44 7700 900123', 'PHONE'));
test('UK landline (01xxx)', () => assertRedacts('Office: 01234 567890', 'PHONE'));
test('UK landline (02xxx)', () => assertRedacts('London: 020 7946 0321', 'PHONE'));
test('phone round-trip', () => roundTrip('Ring 07700 900321 after 5pm.'));
test('random number ignored', () => assertNotRedacted('The answer is 42.'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n📮  UK Postcodes\n');

test('standard postcode (SW1A 1AA)', () => assertRedacts('Address: SW1A 1AA', 'POSTCODE'));
test('postcode no space (EC1A1BB)', () => assertRedacts('EC1A1BB is in the City', 'POSTCODE'));
test('northern postcode (M1 1AE)', () => assertRedacts('Manchester M1 1AE', 'POSTCODE'));
test('postcode round-trip', () => roundTrip('Send to WC2N 5DU please.'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🪪  NI Numbers\n');

test('NI number with spaces', () => assertRedacts('NI: AB 12 34 56 C', 'NINO'));
test('NI number compact', ()    => assertRedacts('AB123456C', 'NINO'));
test('NI round-trip', ()        => roundTrip('Client NI is QQ 12 34 56 C.'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🪪  UK Driving Licenses\n');

test('standard driving license', () => assertRedacts('My license is SMITH905024A99MS', 'DRIVELIC'));
test('driving license round-trip', () => roundTrip('The ID is JONES905024A99MS.'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🏥  NHS Numbers\n');

test('valid NHS number (spaced)', () => assertRedacts('NHS number: 943 567 8122', 'NHS'));
test('valid NHS number (compact)', () => assertRedacts('Number 9435678122', 'NHS'));
test('invalid NHS number checksum ignored', () => assertNotRedacted('943 567 8123')); // invalid checksum
test('NHS number round-trip', () => roundTrip('NHS: 943 567 8122.'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🏦  UK Bank Details\n');

test('sort code with dashes', () => assertRedacts('Sort: 12-34-56', 'BANK'));
test('sort code with spaces', () => assertRedacts('Sort: 12 34 56', 'BANK'));
test('bank account number with label', () => assertRedacts('Account: 12345678', 'BANK'));
test('bank details round-trip', () => roundTrip('Use sort code 12-34-56 and account 12345678.'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n⚖️  Court Claim/Case Numbers\n');

test('standard court claim number', () => assertRedacts('Court Claim: MC12C345', 'CLAIM'));
test('court claim round-trip', () => roundTrip('The reference is Claim No: AB12C345.'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n👤  Names & Organizations\n');

test('dictionary name', () => assertRedacts('Please ask John to help.', 'NAME'));
test('greeting name', () => assertRedacts('Dear Khalid, hope you are well.', 'NAME'));
test('sign-off name', () => assertRedacts('Best regards, Jane', 'NAME'));
test('name propagation across paragraphs', () => {
  const text = 'Dear Khalid,\n\nI want to inform you that Khalid has received the case file.';
  const { redacted, tokens } = engine.redact(text);
  assert.strictEqual(tokens.size, 1, 'Should only have 1 unique name token');
  assert.ok(redacted.includes('{NAME_1}'), 'First occurrence should be redacted');
  assert.ok(redacted.includes('that {NAME_1} has'), 'Second occurrence should be propagated and redacted');
});
test('organization with suffix', () => assertRedacts('Contact Alpha Chambers LLP today.', 'ORG'));
test('context organization without suffix', () => assertRedacts('Draft an email to Femi Balogun at Canon Ideas in Lagos.', 'ORG'));
test('single-word context organization without suffix', () => assertRedacts('Draft an email to Femi Balogun at Starterslab in Lagos.', 'ORG'));
test('name & organization round-trip', () => roundTrip('Dear Khalid, please contact Alpha Chambers LLP.'));
test('lowercase full name in contact-reference context', () => {
  const text = 'draft and email with address location etc of femi balogun, lagos nigeria with number 08138558745, for a letter to ascendia tech talking about wanting more salary email is: femi.balogun@email.com';
  const { redacted, tokens } = engine.redact(text);
  assert.ok(tokens.has('{NAME_1}'), `Expected full lowercase name token — got: "${redacted}"`);
  assert.strictEqual(tokens.get('{NAME_1}'), 'femi balogun');
  assert.ok(!redacted.includes('femi balogun'), `Name should be redacted — got: "${redacted}"`);
});
test('ordinary phrase after of is not treated as a name', () => {
  assertNotRedacted('I need a summary of current market conditions.');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🌍  Global Name Dictionary\n');

test('Yoruba name via dictionary (Bunmi)', () => {
  assertRedacts('Hello Bunmi, please review the contract.', 'NAME', 'Bunmi should be caught via dictionary');
});

test('Yoruba name via dictionary (Tunde)', () => {
  assertRedacts('Regards, Tunde', 'NAME', 'Tunde should be caught via dictionary');
});

test('South Asian name via dictionary (Priya)', () => {
  assertRedacts('Dear Priya, I am writing to you about your account.', 'NAME', 'Priya should be caught via greeting + dictionary');
});

test('Arabic name via dictionary (Fatima)', () => {
  assertRedacts('Hi Fatima, thanks for your message.', 'NAME', 'Fatima should be caught via greeting');
});

test('Eastern European name via dictionary (Anastasia)', () => {
  assertRedacts('Please contact Anastasia for further details.', 'NAME', 'Anastasia should be caught');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🤝  Social Context Name Detection\n');

test('social context: lowercase friend name (bunmi)', () => {
  assertRedacts('I have my friend bunmi joining the product.', 'NAME', 'social context should catch lowercase "bunmi"');
});

test('social context: title case friend name (Bunmi)', () => {
  assertRedacts('I have my friend Bunmi joining the product.', 'NAME', 'social context should catch "Bunmi"');
});

test('social context stopword check: "my friend name is Bunmi"', () => {
  const text = 'my friend name is Bunmi, what would you call him';
  const { redacted, tokens } = engine.redact(text);
  assert.strictEqual(tokens.size, 1, 'Should only catch Bunmi, not "name"');
  assert.ok(tokens.has('{NAME_1}'), 'Token 1 should exist');
  assert.strictEqual(tokens.get('{NAME_1}'), 'Bunmi', '{NAME_1} must be Bunmi');
});

test('social context + propagation — both occurrences caught', () => {
  const text = 'so I have this friend james and Bunmi that want to join the product, what should I tell james?';
  const { redacted, tokens } = engine.redact(text);
  const hasName = [...tokens.keys()].some((k) => k.startsWith('{NAME_'));
  assert.ok(hasName, 'At least one name should be caught in the sentence');
  // "james" appears twice — after first detection both should be replaced
  assert.ok(!redacted.includes('james'), `"james" should be fully redacted — got: "${redacted}"`);
});

test('social context: colleague', () => {
  assertRedacts('I spoke with my colleague Remi about the case.', 'NAME', '"Remi" via colleague context');
});

test('social context: client', () => {
  assertRedacts('My client Priya has signed the agreement.', 'NAME', '"Priya" via client context');
});

test('verb context: tell + Name', () => {
  assertRedacts('What should I tell James about the hearing?', 'NAME', '"James" via "tell" context');
});

test('verb context: ask + Name', () => {
  assertRedacts('Can you ask Sarah to send the documents?', 'NAME', '"Sarah" via "ask" context');
});

test('verb context: contact + Name', () => {
  assertRedacts('Please contact Ngozi directly.', 'NAME', '"Ngozi" via "contact" context');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔡  Case-insensitive Name Propagation\n');

test('james (lowercase) redacted via social context + propagation', () => {
  const { redacted } = engine.redact('my friend james wants to know what to tell james about the meeting');
  assert.ok(!redacted.includes('james'), `"james" should be redacted via social context — got: "${redacted}"`);
});

test('name detected in greeting propagates to lowercase elsewhere', () => {
  // "James" caught via greeting → "james" elsewhere caught via gi propagation
  const { redacted } = engine.redact('Hi James, can you make sure james gets the update?');
  assert.ok(!redacted.includes('James') && !redacted.includes('james'),
    `Both casings should be redacted — got: "${redacted}"`);
});

test('round-trip: social context name', () => {
  roundTrip('My colleague Bunmi and I will handle the matter. Please tell Bunmi to call you back.');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔀  Mixed PII\n');

test('multiple types in one string', () => {
  const text = 'Email john@firm.com, call 07900 000001, postcode W1A 0AX.';
  const { tokens, summary } = engine.redact(text);
  assert.ok(tokens.size >= 3, `Expected ≥3 tokens, got ${tokens.size}`);
  assert.ok(summary.EMAIL > 0, 'EMAIL missing from summary');
  assert.ok(summary.PHONE > 0, 'PHONE missing from summary');
  assert.ok(summary.POSTCODE > 0, 'POSTCODE missing from summary');
});

test('full round-trip with multiple PII', () => {
  roundTrip('Contact jane@example.com or 07700123456 at SW1H 0ET.');
});

test('empty string is safe', () => {
  const { redacted, tokens } = engine.redact('');
  assert.strictEqual(redacted, '');
  assert.strictEqual(tokens.size, 0);
});

test('no PII string passes through unchanged', () => {
  const text = 'The quick brown fox jumped over the lazy dog.';
  const { redacted, tokens } = engine.redact(text);
  assert.strictEqual(redacted, text);
  assert.strictEqual(tokens.size, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
