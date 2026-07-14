/**
 * ARKN Detector — UK National Insurance Number
 * Confidence: 1.0.
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;
  const REGEX =
    /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z]{2}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?[A-D]\b/gi;

  function detect(text) {
    REGEX.lastIndex = 0;
    const candidates = [];
    let m;
    while ((m = REGEX.exec(text)) !== null) {
      candidates.push(create(m.index, m.index + m[0].length, m[0], 'NINO', 1.0, 'regex-nino'));
    }
    return candidates;
  }

  global.__ARKN_DETECTORS__.push({ id: 'regex-nino', detect });
})(typeof window !== 'undefined' ? window : globalThis);
