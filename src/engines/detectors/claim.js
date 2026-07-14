/**
 * ARKN Detector — UK Court Claim / Case Numbers
 * Formats: MC12C345, claim/case/matter references. Confidence: 1.0.
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;
  const REGEX = /\b[A-Z]{1,2}\d{2}[A-Z]\d{3}\b|\b(?:claim|case|matter)\s*(?:no|number)?[:\s\-]*([A-Z0-9]{6,12})\b/gi;

  function detect(text) {
    REGEX.lastIndex = 0;
    const candidates = [];
    let m;
    while ((m = REGEX.exec(text)) !== null) {
      candidates.push(create(m.index, m.index + m[0].length, m[0], 'CLAIM', 1.0, 'regex-claim'));
    }
    return candidates;
  }

  global.__ARKN_DETECTORS__.push({ id: 'regex-claim', detect });
})(typeof window !== 'undefined' ? window : globalThis);
