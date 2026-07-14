/**
 * ARKN Detector — UK Driving License
 * 16-character DVLA format. Confidence: 1.0.
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;
  const REGEX = /\b[A-Z9]{5}\d{6}[A-Z9]{2}\d[A-Z]{2}\b/gi;

  function detect(text) {
    REGEX.lastIndex = 0;
    const candidates = [];
    let m;
    while ((m = REGEX.exec(text)) !== null) {
      candidates.push(create(m.index, m.index + m[0].length, m[0], 'DRIVELIC', 1.0, 'regex-drivelic'));
    }
    return candidates;
  }

  global.__ARKN_DETECTORS__.push({ id: 'regex-drivelic', detect });
})(typeof window !== 'undefined' ? window : globalThis);
