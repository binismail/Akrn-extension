/**
 * ARKN Detector — UK Phone Numbers
 * Detects UK mobiles, landlines, freephone. Confidence: 1.0.
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;
  const REGEX =
    /(?:\+44[\s\-]?|0)(?:(?:7\d{3}[\s\-]?\d{6})|(?:7\d{2}[\s\-]?\d{3}[\s\-]?\d{3})|(?:800[\s\-]?\d{3}[\s\-]?\d{4})|(?:808[\s\-]?\d{3}[\s\-]?\d{4})|(?:1\d{3}[\s\-]?\d{6})|(?:1\d{3}[\s\-]?\d{3}[\s\-]?\d{3,4})|(?:1\d{2}[\s\-]?\d{4}[\s\-]?\d{4})|(?:20[\s\-]?\d{4}[\s\-]?\d{4})|(?:2\d[\s\-]?\d{4}[\s\-]?\d{4})|(?:3\d{2}[\s\-]?\d{3}[\s\-]?\d{4}))\b/g;

  function detect(text) {
    REGEX.lastIndex = 0;
    const candidates = [];
    let m;
    while ((m = REGEX.exec(text)) !== null) {
      candidates.push(create(m.index, m.index + m[0].length, m[0], 'PHONE', 1.0, 'regex-phone'));
    }
    return candidates;
  }

  global.__ARKN_DETECTORS__.push({ id: 'regex-phone', detect });
})(typeof window !== 'undefined' ? window : globalThis);
