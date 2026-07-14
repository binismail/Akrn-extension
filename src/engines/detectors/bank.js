/**
 * ARKN Detector — UK Bank Details
 * Sort codes (XX-XX-XX) and account numbers with labels. Confidence: 1.0.
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;
  const REGEX = /\b\d{2}[\-\s]\d{2}[\-\s]\d{2}\b|(?:\b(?:sort|sc|acc|account|a\/c|bank)[\s\-:]*\d{6,8}\b)/gi;

  function detect(text) {
    REGEX.lastIndex = 0;
    const candidates = [];
    let m;
    while ((m = REGEX.exec(text)) !== null) {
      candidates.push(create(m.index, m.index + m[0].length, m[0], 'BANK', 1.0, 'regex-bank'));
    }
    return candidates;
  }

  global.__ARKN_DETECTORS__.push({ id: 'regex-bank', detect });
})(typeof window !== 'undefined' ? window : globalThis);
