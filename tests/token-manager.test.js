/**
 * ARKN — Token Manager Tests
 * Tests the in-memory session token store logic used by the content world.
 * Run with: node tests/token-manager.test.js
 */

const assert = require('assert');

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

// ── Inline token manager (mirrors content-world logic) ────────────────────────

class TokenManager {
  constructor() {
    this.sessions = {};
  }

  sync(sessionId, entries) {
    if (!this.sessions[sessionId]) this.sessions[sessionId] = {};
    for (const [token, original] of entries) {
      this.sessions[sessionId][token] = original;
    }
  }

  resolve(sessionId, token) {
    return this.sessions[sessionId]?.[token] ?? null;
  }

  getAll(sessionId) {
    return { ...( this.sessions[sessionId] ?? {}) };
  }

  clear(sessionId) {
    delete this.sessions[sessionId];
  }

  resolveAcrossSessions(token) {
    for (const session of Object.values(this.sessions)) {
      if (session[token]) return session[token];
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🗂️  Token sync & resolution\n');

test('syncs tokens for a session', () => {
  const tm = new TokenManager();
  tm.sync('session-1', [['[EMAIL_1]', 'alice@firm.com']]);
  assert.strictEqual(tm.resolve('session-1', '[EMAIL_1]'), 'alice@firm.com');
});

test('returns null for unknown token', () => {
  const tm = new TokenManager();
  assert.strictEqual(tm.resolve('session-1', '[EMAIL_99]'), null);
});

test('returns null for unknown session', () => {
  const tm = new TokenManager();
  tm.sync('session-1', [['[PHONE_1]', '07900000001']]);
  assert.strictEqual(tm.resolve('session-99', '[PHONE_1]'), null);
});

test('accumulates tokens across multiple syncs', () => {
  const tm = new TokenManager();
  tm.sync('s1', [['[EMAIL_1]', 'a@b.com']]);
  tm.sync('s1', [['[PHONE_1]', '07700000001']]);
  assert.strictEqual(tm.resolve('s1', '[EMAIL_1]'), 'a@b.com');
  assert.strictEqual(tm.resolve('s1', '[PHONE_1]'), '07700000001');
});

test('later sync overwrites duplicate token', () => {
  const tm = new TokenManager();
  tm.sync('s1', [['[EMAIL_1]', 'old@example.com']]);
  tm.sync('s1', [['[EMAIL_1]', 'new@example.com']]);
  assert.strictEqual(tm.resolve('s1', '[EMAIL_1]'), 'new@example.com');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔒  Session isolation\n');

test('sessions do not bleed into each other', () => {
  const tm = new TokenManager();
  tm.sync('session-A', [['[EMAIL_1]', 'alice@a.com']]);
  tm.sync('session-B', [['[EMAIL_1]', 'bob@b.com']]);
  assert.strictEqual(tm.resolve('session-A', '[EMAIL_1]'), 'alice@a.com');
  assert.strictEqual(tm.resolve('session-B', '[EMAIL_1]'), 'bob@b.com');
});

test('clearing one session does not affect another', () => {
  const tm = new TokenManager();
  tm.sync('s1', [['[EMAIL_1]', 'a@a.com']]);
  tm.sync('s2', [['[EMAIL_1]', 'b@b.com']]);
  tm.clear('s1');
  assert.strictEqual(tm.resolve('s1', '[EMAIL_1]'), null);
  assert.strictEqual(tm.resolve('s2', '[EMAIL_1]'), 'b@b.com');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🌐  Cross-session fallback (for unmasker)\n');

test('resolves token across sessions when sessionId unknown', () => {
  const tm = new TokenManager();
  tm.sync('some-session', [['[POSTCODE_1]', 'SW1A 1AA']]);
  assert.strictEqual(tm.resolveAcrossSessions('[POSTCODE_1]'), 'SW1A 1AA');
});

test('returns null when token not found in any session', () => {
  const tm = new TokenManager();
  assert.strictEqual(tm.resolveAcrossSessions('[NINO_99]'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n📦  getAll\n');

test('getAll returns shallow copy of session tokens', () => {
  const tm = new TokenManager();
  tm.sync('s1', [['[EMAIL_1]', 'a@b.com'], ['[PHONE_1]', '07700000000']]);
  const all = tm.getAll('s1');
  assert.strictEqual(all['[EMAIL_1]'], 'a@b.com');
  assert.strictEqual(all['[PHONE_1]'], '07700000000');
  assert.strictEqual(Object.keys(all).length, 2);
});

test('getAll returns empty object for unknown session', () => {
  const tm = new TokenManager();
  assert.deepStrictEqual(tm.getAll('unknown'), {});
});

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
