/**
 * ARKN Detector — NHS Number
 * 10-digit number with Modulus 11 checksum validation. Confidence: 1.0.
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;
  const REGEX = /\b\d{3}[\s\-]?\d{3}[\s\-]?\d{4}\b/g;

  function isValidNhsNumber(str) {
    const digits = str.replace(/[\s\-]/g, '');
    if (digits.length !== 10) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(digits[i], 10) * (10 - i);
    }
    const remainder = sum % 11;
    const checkDigit = remainder === 0 ? 0 : 11 - remainder;
    if (checkDigit === 11) return false;
    return checkDigit === parseInt(digits[9], 10);
  }

  function detect(text) {
    REGEX.lastIndex = 0;
    const candidates = [];
    let m;
    while ((m = REGEX.exec(text)) !== null) {
      if (isValidNhsNumber(m[0])) {
        candidates.push(create(m.index, m.index + m[0].length, m[0], 'NHS', 1.0, 'regex-nhs'));
      }
    }
    return candidates;
  }

  global.__ARKN_DETECTORS__.push({ id: 'regex-nhs', detect });
})(typeof window !== 'undefined' ? window : globalThis);
