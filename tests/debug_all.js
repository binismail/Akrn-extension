globalThis.window = globalThis;
require('../src/engines/candidate.js');
// Load all detectors
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

const text = "my friend name is Khalid, and we this project-gain coming up what do you think?";
const policyConfig = {
  customRules: [
    { name: 'NON_ME', type: 'literal', pattern: 'project-gain', desc: 'custom literal matching rule' }
  ]
};

const result = globalThis.__ARKN_REGEX__.redact(text, {}, policyConfig);
console.log('--- REDACTED RESULT ---');
console.log('Redacted:', result.redacted);
console.log('Tokens:', result.tokens);
console.log('Summary:', result.summary);
