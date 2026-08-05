const assert = require('assert');

globalThis.window = globalThis;
globalThis.__ARKN_PIPELINE__ = {
  createCandidate(start, end, text, type, confidence, detector) {
    return { start, end, text, type, confidence, detector };
  },
};
globalThis.__ARKN_DETECTORS__ = [];

let resolveResponse;
globalThis.addEventListener = (type, callback) => {
  if (type === 'arkn:ner-response') globalThis.__nerResponse = callback;
};
globalThis.dispatchEvent = (event) => {
  if (event.type === 'arkn:ner-request') {
    resolveResponse = () => globalThis.__nerResponse({
      detail: {
        requestId: event.detail.requestId,
        text: event.detail.text,
        spans: [
          { start: 8, end: 15, entity_group: 'PER', score: 0.93 },
          { start: 19, end: 32, entity_group: 'ORG', score: 0.88 },
          { start: 36, end: 41, entity_group: 'LOC', score: 0.81 },
        ],
      },
    });
  }
};

require('../src/engines/detectors/ner.js');
const detector = globalThis.__ARKN_NER__;
assert.ok(detector, 'NER adapter should be exposed');

test('maps NER spans into ARKN candidates', async () => {
  const promise = detector.prefetch('Contact Balogun at Ascendia Tech in Lagos');
  resolveResponse();
  const spans = await promise;
  assert.deepStrictEqual(spans.map((span) => span.type), ['NAME', 'ORG', 'LOCATION']);
  assert.strictEqual(spans[0].text, 'Balogun');
  assert.strictEqual(spans[1].confidence, 0.88);
});

test('maps BIO entity labels with offsets supplied by the worker', async () => {
  const promise = detector.prefetch('Femi works at Ascendia Tech');
  resolveResponse = () => globalThis.__nerResponse({
    detail: {
      requestId: 2,
      text: 'Femi works at Ascendia Tech',
      spans: [
        { start: 0, end: 4, entity_group: 'PER', score: 0.91 },
        { start: 14, end: 27, entity_group: 'ORG', score: 0.89 },
      ],
    },
  });
  resolveResponse();
  const spans = await promise;
  assert.deepStrictEqual(spans.map((span) => span.type), ['NAME', 'ORG']);
  assert.strictEqual(spans[1].text, 'Ascendia Tech');
});

test('supports lowercase names and organisations after worker normalization', async () => {
  const text = 'draft and email with address location etc of femi balogun, lagos nigeria with number 08138558745,, for a letter to ascendia tech talking about wanting more salary email is l: femi.balogun@email.com';
  const promise = detector.prefetch(text);
  resolveResponse = () => globalThis.__nerResponse({
    detail: {
      requestId: 3,
      text,
      spans: [
        { start: 45, end: 57, entity_group: 'PER', score: 0.99 },
        { start: 115, end: 128, entity_group: 'ORG', score: 0.99 },
      ],
    },
  });
  resolveResponse();
  const spans = await promise;
  assert.deepStrictEqual(spans.map((span) => span.type), ['NAME', 'ORG']);
  assert.deepStrictEqual(spans.map((span) => span.text), ['femi balogun', 'ascendia tech']);
});

test('keeps adjacent person and location entities separate', async () => {
  const text = 'femi balogun, lagos nigeria';
  const promise = detector.prefetch(text);
  resolveResponse = () => globalThis.__nerResponse({
    detail: {
      requestId: 4,
      text,
      spans: [
        { start: 0, end: 12, entity_group: 'PER', score: 0.99 },
        { start: 14, end: 27, entity_group: 'LOC', score: 0.99 },
      ],
    },
  });
  resolveResponse();
  const spans = await promise;
  assert.deepStrictEqual(spans.map((span) => span.text), ['femi balogun', 'lagos nigeria']);
});

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}
