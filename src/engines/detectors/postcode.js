/**
 * ARKN Detector — UK Postcodes
 * Detects UK postcodes (inward + outward). Confidence: 1.0.
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;
  const REGEX = /\b[A-Z]{1,2}[0-9]{1,2}[A-Z]?\s?[0-9][A-Z]{2}\b/gi;

  function detect(text) {
    REGEX.lastIndex = 0;
    const candidates = [];
    let m;
    while ((m = REGEX.exec(text)) !== null) {
      candidates.push(create(m.index, m.index + m[0].length, m[0], 'POSTCODE', 1.0, 'regex-postcode'));
    }
    return candidates;
  }

  global.__ARKN_DETECTORS__.push({ id: 'regex-postcode', detect });
})(typeof window !== 'undefined' ? window : globalThis);
