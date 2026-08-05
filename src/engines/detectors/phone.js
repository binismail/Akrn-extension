/**
 * ARKN Detector — International Phone Numbers
 * Detects structured international, UK, Nigerian, US/Canada, and Indian numbers.
 * Confidence: 1.0.
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;

  // Each pattern requires a meaningful phone signal. The generic branch only
  // accepts a leading + or grouped separators, avoiding arbitrary integers.
  const PATTERNS = [
    /\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?|\d{1,4}[\s.-])\d{3,4}(?:[\s.-]?\d{3,4}){1,2}/g,
    /\+234[\s.-]?(?:[789]0\d|[789]1\d|[789]\d{2})[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    /\b0[789][01](?:[\s.-]?\d){8,9}\b/g,
    /\+1[\s.-]?\(?[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    /\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    /\b[2-9]\d{2}-\d{3}-\d{4}\b/g,
    /(?:\+44[\s.-]?|0)(?:7\d{3}[\s.-]?\d{6}|7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}|1\d{3}[\s.-]?\d{6}|1\d{2}[\s.-]?\d{4}[\s.-]?\d{4}|2\d[\s.-]?\d{4}[\s.-]?\d{4})\b/g,
    /\+91[\s.-]?[6-9]\d{4}[\s.-]?\d{5}\b/g,
    /\b(?:phone|mobile|tel|telephone)\s*(?:number|no\.?|#)?\s*[:=-]?\s*([6-9]\d{9})\b/gi,
  ];

  function detect(text) {
    const candidates = [];

    for (const regex of PATTERNS) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const matchedText = match[1] || match[0];
        const matchStart = match[1]
          ? match.index + match[0].indexOf(match[1])
          : match.index;
        candidates.push(create(
          matchStart,
          matchStart + matchedText.length,
          matchedText,
          'PHONE',
          1.0,
          'regex-phone-intl'
        ));
      }
    }

    return candidates
      .sort((a, b) => {
        const lengthDiff = (b.end - b.start) - (a.end - a.start);
        return lengthDiff || a.start - b.start;
      })
      .filter((candidate, index, all) => {
        return !all.slice(0, index).some((kept) =>
          candidate.start < kept.end && candidate.end > kept.start
        );
      })
      .sort((a, b) => a.start - b.start);
  }

  global.__ARKN_DETECTORS__.push({ id: 'regex-phone-intl', detect });
})(typeof window !== 'undefined' ? window : globalThis);
