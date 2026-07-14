/**
 * ARKN — Interception Latency Benchmark
 * Measures how long pipeline.redact() takes on realistic prompts.
 */

// Load the pipeline modules
globalThis.window = globalThis;
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

// ── Test prompts (realistic user inputs) ────────────────────────────────────
const prompts = {
  'Short name only': 'my name is Khalid',
  'Name + email': 'Hello, my name is Khalid, email is khalid@example.com',
  'Multi-PII': 'Hi, I\'m James Smith, email james@lawfirm.co.uk, phone 07712345678, postcode SW1A 1AA, NI number AB123456C',
  'Social context': 'so I have this friend Bunmi, he is a product designer I love working with him...',
  'Long paragraph': `Dear Dr Smith,

I am writing to confirm that my client, Mrs Patricia Johnson (NI: QQ 12 34 56 A), 
residing at 42 Baker Street, London W1U 3BW, has instructed me to proceed with 
the matter referenced MC12C345. Her NHS number is 943 476 5919 and her bank 
details are sort code 20-45-67, account 12345678. Please contact her solicitor 
James Williams at james.williams@chambers.co.uk or on 020 7946 0958.

Kind regards,
Khalid Ismail
Senior Associate
Smith & Partners LLP`,
  'No PII (control)': 'What is the meaning of life? Can you explain quantum computing in simple terms?',
  'Names only (dictionary)': 'I spoke with Priya, Bunmi, and Anastasia about the project. James will join tomorrow.',
  'Repeated PII': 'Email me at test@example.com. My backup email is backup@example.com. Call me on 07700900000 or 07700900001. I live at EC1A 1BB near SW1A 2AA.',
};

// ── Benchmark runner ────────────────────────────────────────────────────────
const ITERATIONS = 1000;

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║        ARKN — Interception Latency Benchmark                ║');
console.log('║        Iterations per prompt: ' + ITERATIONS + '                           ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');

const results = [];

for (const [label, text] of Object.entries(prompts)) {
  // Warmup
  for (let i = 0; i < 10; i++) engine.redact(text);

  // Timed run
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    engine.redact(text);
  }
  const elapsed = performance.now() - start;
  const avgMs = elapsed / ITERATIONS;
  const avgUs = avgMs * 1000;

  // Get redaction result for display
  const { summary } = engine.redact(text);
  const piiCount = Object.values(summary).reduce((a, b) => a + b, 0);

  results.push({ label, avgMs, avgUs, piiCount, textLen: text.length });

  const bar = '█'.repeat(Math.min(Math.round(avgUs / 5), 60));
  console.log(`  ${label}`);
  console.log(`    ${text.length} chars │ ${piiCount} PII items │ ${avgMs.toFixed(4)} ms (${avgUs.toFixed(1)} µs) ${bar}`);
  console.log('');
}

console.log('──────────────────────────────────────────────────────────────');
console.log('');

const fastest = Math.min(...results.map(r => r.avgMs));
const slowest = Math.max(...results.map(r => r.avgMs));
const avg = results.reduce((s, r) => s + r.avgMs, 0) / results.length;

console.log(`  Fastest:  ${fastest.toFixed(4)} ms  (${(fastest * 1000).toFixed(1)} µs)`);
console.log(`  Slowest:  ${slowest.toFixed(4)} ms  (${(slowest * 1000).toFixed(1)} µs)`);
console.log(`  Average:  ${avg.toFixed(4)} ms  (${(avg * 1000).toFixed(1)} µs)`);
console.log('');
console.log(`  For comparison:`);
console.log(`    Network RTT to OpenAI/Anthropic/Google: ~200-800 ms`);
console.log(`    User keystroke perception threshold:     ~100 ms`);
console.log(`    In-browser NER (Transformers.js):        ~200-500 ms`);
console.log('');
