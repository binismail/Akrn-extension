/**
 * ARKN Detector — Email
 * Detects email addresses. Confidence: 1.0 (regex is definitive for emails).
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;
  const REGEX = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

  function detect(text) {
    REGEX.lastIndex = 0;
    const candidates = [];
    let m;
    while ((m = REGEX.exec(text)) !== null) {
      candidates.push(create(m.index, m.index + m[0].length, m[0], 'EMAIL', 1.0, 'regex-email'));
    }
    return candidates;
  }

  global.__ARKN_DETECTORS__.push({ id: 'regex-email', detect });
})(typeof window !== 'undefined' ? window : globalThis);
