globalThis.window = globalThis;
require('../src/engines/candidate.js');
require('../src/engines/detectors/name.js');
require('../src/engines/merger.js');
require('../src/engines/scorer.js');
require('../src/engines/policy.js');
require('../src/engines/tokenizer.js');

const detect = globalThis.__ARKN_DETECTORS__.find(d => d.id === 'name-detector').detect;
const text = "Please draft a message for me not an email but a text, my friend Khalid is coming over for dinner i want to ask if he's making by 6pm today";

const candidates = detect(text);
console.log('--- RAW CANDIDATES ---');
candidates.forEach(c => {
  console.log(`[${c.detector}] text: "${c.text}" span: [${c.start}, ${c.end}] confidence: ${c.confidence}`);
});

const pipeline = globalThis.__ARKN_PIPELINE__;
const merged = pipeline.merge(candidates);
console.log('--- MERGED ---');
merged.forEach(c => {
  console.log(`text: "${c.text}" span: [${c.start}, ${c.end}] confidence: ${c.confidence}`);
});

const scored = pipeline.score(merged, text);
const accepted = pipeline.applyPolicy(scored);
console.log('--- ACCEPTED ---');
accepted.forEach(c => {
  console.log(`text: "${c.text}" span: [${c.start}, ${c.end}] confidence: ${c.confidence}`);
});
